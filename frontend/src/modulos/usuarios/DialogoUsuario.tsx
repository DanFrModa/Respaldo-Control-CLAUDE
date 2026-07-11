import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  type DatosUsuarioCrear,
  type DatosUsuarioEditar,
  esquemaUsuarioCrear,
  esquemaUsuarioEditar,
} from '@/api/esquemas';
import { useRoles } from '@/api/roles';
import type { Usuario, UsuarioCrear, UsuarioEditar } from '@/api/tipos';
import { useActualizarUsuario, useCrearUsuario } from '@/api/usuarios';
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

import { SelectorRoles } from './SelectorRoles';

/** Valores por defecto de un alta (todo vacio). */
const VALORES_ALTA: DatosUsuarioCrear = {
  username: '',
  nombre: '',
  email: '',
  password: '',
};

/**
 * Dialogo de alta y edicion de usuario (react-hook-form + Zod). En ALTA pide
 * usuario, nombre, correo (opcional) y contraseña, mas el selector multiple de
 * roles y la bandera de auditor. En EDICION el usuario es inmutable y la
 * contraseña se cambia en un dialogo aparte, asi que el formulario solo lleva
 * nombre/correo + roles + auditor + activo/bloqueado son acciones de fila. La
 * validacion de captura es solo UX: el backend re-valida y es la autoridad (A1).
 *
 * Los roles y `esAuditor` se manejan como estado local (no son campos de texto
 * del schema) y se mandan dentro del cuerpo del API al guardar; en edicion los
 * roles van por el mismo PATCH (`idsRoles`), que el backend trata como reemplazo.
 */
export function DialogoUsuario({
  abierto,
  alCambiarAbierto,
  usuario,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Usuario a editar; `undefined` -> alta. */
  usuario: Usuario | undefined;
}): React.JSX.Element {
  const esEdicion = usuario !== undefined;
  const crear = useCrearUsuario();
  const actualizar = useActualizarUsuario();
  const guardando = crear.isPending || actualizar.isPending;

  const roles = useRoles();

  // Roles seleccionados y bandera de auditor: estado local (no son texto del schema).
  const [idsRoles, setIdsRoles] = useState<number[]>([]);
  const [esAuditor, setEsAuditor] = useState(false);

  const formularioAlta = useForm<DatosUsuarioCrear>({
    resolver: zodResolver(esquemaUsuarioCrear),
    defaultValues: VALORES_ALTA,
  });
  const formularioEdicion = useForm<DatosUsuarioEditar>({
    resolver: zodResolver(esquemaUsuarioEditar),
    defaultValues: { nombre: '', email: '' },
  });

  // Al abrir, sincroniza ambos formularios y el estado local con el usuario (o limpia).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (usuario) {
      formularioEdicion.reset({ nombre: usuario.nombre, email: usuario.email });
      setIdsRoles(usuario.roles.map((rol) => rol.id));
      setEsAuditor(usuario.esAuditor);
    } else {
      formularioAlta.reset(VALORES_ALTA);
      setIdsRoles([]);
      setEsAuditor(false);
    }
  }, [abierto, usuario, formularioAlta, formularioEdicion]);

  const enviarAlta = formularioAlta.handleSubmit((datos) => {
    const cuerpo: UsuarioCrear = {
      username: datos.username,
      nombre: datos.nombre,
      password: datos.password,
      esAuditor,
      idsRoles,
    };
    if (datos.email.length > 0) {
      cuerpo.email = datos.email;
    }
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Usuario "${resultado.username}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const enviarEdicion = formularioEdicion.handleSubmit((datos) => {
    if (!usuario) {
      return;
    }
    const cuerpo: UsuarioEditar = {
      nombre: datos.nombre,
      esAuditor,
      idsRoles,
      ...(datos.email.length > 0 ? { email: datos.email } : {}),
    };
    actualizar.mutate(
      { id: usuario.id, cuerpo },
      {
        onSuccess: (resultado) => {
          toast.success(`Usuario "${resultado.username}" actualizado.`);
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  });

  const erroresAlta = formularioAlta.formState.errors;
  const erroresEdicion = formularioEdicion.formState.errors;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void (esEdicion ? enviarEdicion(e) : enviarAlta(e))} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos, los roles o el estado de auditor de este usuario.'
                : 'Captura los datos del nuevo usuario y asígnale sus roles.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto py-4 pr-1">
            <FieldGroup>
              <LeyendaObligatorios />
              {esEdicion ? (
                <Field>
                  <FieldLabel htmlFor="usuario-username">Usuario</FieldLabel>
                  <Input id="usuario-username" value={usuario.username} disabled readOnly />
                </Field>
              ) : (
                <Field data-invalid={Boolean(erroresAlta.username)}>
                  <FieldLabel htmlFor="usuario-username" required>
                    Usuario
                  </FieldLabel>
                  <Input
                    id="usuario-username"
                    autoFocus
                    placeholder="Ej. lmendez"
                    aria-invalid={Boolean(erroresAlta.username)}
                    disabled={guardando}
                    {...formularioAlta.register('username')}
                  />
                  <FieldDescription>
                    Con el que inicia sesión. No se puede cambiar después.
                  </FieldDescription>
                  <FieldError errors={[erroresAlta.username]} />
                </Field>
              )}

              <Field data-invalid={Boolean(esEdicion ? erroresEdicion.nombre : erroresAlta.nombre)}>
                <FieldLabel htmlFor="usuario-nombre" required>
                  Nombre
                </FieldLabel>
                {esEdicion ? (
                  <Input
                    id="usuario-nombre"
                    autoFocus
                    placeholder="Ej. Laura Méndez"
                    aria-invalid={Boolean(erroresEdicion.nombre)}
                    disabled={guardando}
                    {...formularioEdicion.register('nombre')}
                  />
                ) : (
                  <Input
                    id="usuario-nombre"
                    placeholder="Ej. Laura Méndez"
                    aria-invalid={Boolean(erroresAlta.nombre)}
                    disabled={guardando}
                    {...formularioAlta.register('nombre')}
                  />
                )}
                <FieldError errors={[esEdicion ? erroresEdicion.nombre : erroresAlta.nombre]} />
              </Field>

              <Field data-invalid={Boolean(esEdicion ? erroresEdicion.email : erroresAlta.email)}>
                <FieldLabel htmlFor="usuario-email">Correo</FieldLabel>
                {esEdicion ? (
                  <Input
                    id="usuario-email"
                    type="email"
                    placeholder="Ej. laura@frmoda.com.mx"
                    aria-invalid={Boolean(erroresEdicion.email)}
                    disabled={guardando}
                    {...formularioEdicion.register('email')}
                  />
                ) : (
                  <Input
                    id="usuario-email"
                    type="email"
                    placeholder="Ej. laura@frmoda.com.mx"
                    aria-invalid={Boolean(erroresAlta.email)}
                    disabled={guardando}
                    {...formularioAlta.register('email')}
                  />
                )}
                <FieldError errors={[esEdicion ? erroresEdicion.email : erroresAlta.email]} />
              </Field>

              {!esEdicion ? (
                <Field data-invalid={Boolean(erroresAlta.password)}>
                  <FieldLabel htmlFor="usuario-password" required>
                    Contraseña
                  </FieldLabel>
                  <Input
                    id="usuario-password"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={Boolean(erroresAlta.password)}
                    disabled={guardando}
                    {...formularioAlta.register('password')}
                  />
                  <FieldDescription>
                    Mínimo 8 caracteres. Combina letras, números y símbolos, o usa una frase larga.
                  </FieldDescription>
                  <FieldError errors={[erroresAlta.password]} />
                </Field>
              ) : null}

              <SelectorRoles
                roles={roles.data ?? []}
                cargando={roles.isPending}
                error={roles.isError ? roles.error.message : null}
                seleccionados={idsRoles}
                alCambiar={setIdsRoles}
                deshabilitado={guardando}
              />

              <Field orientation="horizontal">
                <input
                  id="usuario-auditor"
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  checked={esAuditor}
                  disabled={guardando}
                  onChange={(e) => setEsAuditor(e.target.checked)}
                  data-testid="usuario-auditor"
                />
                <FieldLabel htmlFor="usuario-auditor" className="font-normal">
                  Es auditor de calidad
                </FieldLabel>
              </Field>
              <FieldDescription className="-mt-2">
                Podrá firmar auditorías de calidad.
              </FieldDescription>
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
              data-testid="guardar-usuario"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear usuario'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
