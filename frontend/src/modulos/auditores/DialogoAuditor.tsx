import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useActualizarAuditor, useCrearAuditor } from '@/api/auditores';
import {
  type DatosAuditorFormulario,
  esquemaAuditorFormulario,
  NIVELES_AQL_AUDITOR,
  ROLES_AUDITOR,
} from '@/api/esquemas';
import type { Auditor } from '@/api/tipos';
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

/** Valores por defecto de un alta (rol y nivel AQL más comunes en el catálogo). */
const DEFECTOS: DatosAuditorFormulario = { nombre: '', rol: 'Auditor', nivelAql: '2.5' };

/**
 * Diálogo de alta y edición de auditor (react-hook-form + Zod). Si recibe un `auditor` edita
 * (PATCH); si no, da de alta (POST). Al guardar con éxito cierra y avisa con un toast; el error del
 * servidor (validación, conflicto de nombre, permiso) se muestra como toast con el mensaje del
 * backend. La validación de captura es solo UX: el backend re-valida y es la autoridad (A1).
 */
export function DialogoAuditor({
  abierto,
  alCambiarAbierto,
  auditor,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Auditor a editar; `undefined` -> alta. */
  auditor: Auditor | undefined;
}): React.JSX.Element {
  const esEdicion = auditor !== undefined;
  const crear = useCrearAuditor();
  const actualizar = useActualizarAuditor();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosAuditorFormulario>({
    resolver: zodResolver(esquemaAuditorFormulario),
    defaultValues: DEFECTOS,
  });

  // Al abrir, sincroniza el formulario con el auditor en edición (o lo limpia para un alta).
  useEffect(() => {
    if (abierto) {
      formulario.reset(
        auditor
          ? { nombre: auditor.nombre, rol: auditor.rol, nivelAql: auditor.nivelAql }
          : DEFECTOS,
      );
    }
  }, [abierto, auditor, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      actualizar.mutate(
        { id: auditor.id, cuerpo: datos },
        {
          onSuccess: (resultado) => {
            toast.success(`Auditor "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(datos, {
      onSuccess: (resultado) => {
        toast.success(`Auditor "${resultado.nombre}" creado.`);
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
            <DialogTitle>{esEdicion ? 'Editar auditor' : 'Nuevo auditor'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre, el rol o el nivel AQL de este auditor.'
                : 'Captura los datos del nuevo auditor del catálogo.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="auditor-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="auditor-nombre"
                autoFocus
                placeholder="Ej. José Ramírez"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.rol)}>
              <FieldLabel htmlFor="auditor-rol">Rol</FieldLabel>
              <SelectNativo
                id="auditor-rol"
                aria-invalid={Boolean(errors.rol)}
                disabled={guardando}
                {...formulario.register('rol')}
              >
                {ROLES_AUDITOR.map((rol) => (
                  <option key={rol} value={rol}>
                    {rol}
                  </option>
                ))}
              </SelectNativo>
              <FieldError errors={[errors.rol]} />
            </Field>

            <Field data-invalid={Boolean(errors.nivelAql)}>
              <FieldLabel htmlFor="auditor-nivel">Nivel AQL</FieldLabel>
              <SelectNativo
                id="auditor-nivel"
                aria-invalid={Boolean(errors.nivelAql)}
                disabled={guardando}
                {...formulario.register('nivelAql')}
              >
                {NIVELES_AQL_AUDITOR.map((nivel) => (
                  <option key={nivel} value={nivel}>
                    {nivel}
                  </option>
                ))}
              </SelectNativo>
              <FieldDescription>
                Qué tan estricto certifica: 1.0 estricto · 2.5 estándar · 10 laxo.
              </FieldDescription>
              <FieldError errors={[errors.nivelAql]} />
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
              data-testid="guardar-auditor"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear auditor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
