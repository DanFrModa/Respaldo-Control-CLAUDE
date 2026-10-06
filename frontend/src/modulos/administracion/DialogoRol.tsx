import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  useActualizarRol,
  useCrearRol,
  usePermisosCatalogo,
  type RolCrear,
  type RolEditar,
} from '@/api/roles';
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

import { ArbolPermisos } from './ArbolPermisos';

/** Tope del nombre de un rol (el mismo del backend y del esquema de abajo). */
const MAX_NOMBRE_ROL = 60;

/**
 * Nombre precargado de una copia: «Copia de <origen>», recortado al tope para que un origen largo
 * no deje el formulario en rojo desde que abre (la persona lo puede reescribir de todos modos).
 */
function nombreDeCopia(nombreOrigen: string): string {
  return `Copia de ${nombreOrigen}`.slice(0, MAX_NOMBRE_ROL).trimEnd();
}

/** Esquema de captura de un rol (solo UX; el backend re-valida, A1). */
const esquemaRolFormulario = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(MAX_NOMBRE_ROL, { error: 'El nombre no puede tener más de 60 caracteres' }),
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
 *
 * ⭐ Con `origen` (fila 0.248) es un ALTA POR DUPLICADO: nombre «Copia de …», la descripción del
 * origen y el árbol de permisos YA PALOMEADO con sus claves, editable antes de guardar. Va al mismo
 * `POST /api/roles` con las claves marcadas; el origen nunca se toca (no hay PATCH ni PUT). Las
 * claves salen del propio `Rol` de la lista (`GET /api/roles` las trae completas, ordenadas), así
 * que no hace falta pedir el detalle. Sólo se mandan las que existen en el catálogo que se pintó:
 * lo que la persona no puede ver tampoco lo puede desmarcar, y el backend lo rechazaría.
 */
export function DialogoRol({
  abierto,
  alCambiarAbierto,
  rol,
  origen,
  alCrear,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Rol a editar; `undefined` -> alta. */
  rol: Rol | undefined;
  /** Rol del que se copia (alta por duplicado); se ignora si hay `rol` (edición). */
  origen?: Rol | undefined;
  /** Se llama con el rol recién creado (alta en blanco o por duplicado). */
  alCrear?: (creado: Rol) => void;
}): React.JSX.Element {
  const esEdicion = rol !== undefined;
  const esDuplicado = !esEdicion && origen !== undefined;
  const esSistema = rol?.esSistema ?? false;
  const crear = useCrearRol();
  const actualizar = useActualizarRol();
  const catalogo = usePermisosCatalogo();
  const guardando = crear.isPending || actualizar.isPending;

  // Claves marcadas en el alta por duplicado (arrancan con las del origen al abrir).
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set());
  // Claves que de verdad existen en el catálogo pintado (las únicas que se mandan).
  const clavesCatalogo = useMemo(
    () => new Set((catalogo.data ?? []).flatMap((g) => g.permisos.map((p) => p.clave))),
    [catalogo.data],
  );

  const formulario = useForm<DatosRolFormulario>({
    resolver: zodResolver(esquemaRolFormulario),
    defaultValues: { nombre: '', descripcion: '' },
  });

  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset(
      rol
        ? { nombre: rol.nombre, descripcion: rol.descripcion }
        : origen
          ? { nombre: nombreDeCopia(origen.nombre), descripcion: origen.descripcion }
          : { nombre: '', descripcion: '' },
    );
    setSeleccion(new Set(!rol && origen ? origen.clavesPermisos : []));
  }, [abierto, rol, origen, formulario]);

  function alternar(clave: string): void {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(clave)) {
        siguiente.delete(clave);
      } else {
        siguiente.add(clave);
      }
      return siguiente;
    });
  }

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

    // Alta en blanco: el rol nace SIN permisos; se asignan después en el árbol del detalle.
    // Alta por duplicado: nace con lo palomeado (sólo claves del catálogo pintado).
    const cuerpo: RolCrear = esDuplicado
      ? {
          nombre: datos.nombre,
          descripcion: datos.descripcion,
          clavesPermisos: [...seleccion].filter((clave) => clavesCatalogo.has(clave)),
        }
      : { nombre: datos.nombre, descripcion: datos.descripcion };
    crear.mutate(cuerpo, {
      onSuccess: (r) => {
        toast.success(
          esDuplicado
            ? `Rol "${r.nombre}" creado con ${r.clavesPermisos.length} permiso${r.clavesPermisos.length === 1 ? '' : 's'}.`
            : `Rol "${r.nombre}" creado. Asígnale permisos en su detalle.`,
        );
        alCambiarAbierto(false);
        alCrear?.(r);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className={esDuplicado ? 'sm:max-w-3xl' : undefined}>
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>
              {esEdicion ? 'Editar rol' : esDuplicado ? 'Duplicar rol' : 'Nuevo rol'}
            </DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre o la descripción de este rol. Sus permisos se editan en el detalle.'
                : esDuplicado
                  ? `Se crea un rol NUEVO con los permisos de «${origen.nombre}» ya marcados. Ajusta lo que necesites; «${origen.nombre}» no cambia.`
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

            {esDuplicado ? (
              <div className="space-y-2" data-testid="arbol-duplicado">
                <p className="text-sm font-medium">
                  Permisos{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({[...seleccion].filter((c) => clavesCatalogo.has(c)).length} marcados)
                  </span>
                </p>
                {catalogo.isPending ? (
                  <p className="text-sm text-muted-foreground">Cargando catálogo de permisos…</p>
                ) : catalogo.isError ? (
                  <p className="text-sm text-destructive">{catalogo.error.message}</p>
                ) : (
                  <ArbolPermisos
                    catalogo={catalogo.data}
                    seleccion={seleccion}
                    alAlternar={alternar}
                    deshabilitado={guardando}
                  />
                )}
              </div>
            ) : null}
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
              // Sin catálogo no hay árbol que confirmar: no se crea la copia a ciegas.
              disabled={guardando || (esDuplicado && catalogo.data === undefined)}
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
