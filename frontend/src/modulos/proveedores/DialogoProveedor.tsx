import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  type DatosProveedorFormulario,
  ETIQUETAS_TIPO_PROVEEDOR,
  esquemaProveedorFormulario,
  TIPOS_PROVEEDOR,
} from '@/api/esquemas';
import { useActualizarProveedor, useCrearProveedor } from '@/api/proveedores';
import type { Proveedor, ProveedorCrear } from '@/api/tipos';
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
import { SelectNativo } from '@/components/ui/native-select';

/** Valores por defecto de un alta (todos vacios; tipo sin clasificar). */
const VALORES_INICIALES: DatosProveedorFormulario = {
  nombre: '',
  razonSocial: '',
  tipo: 'SIN_CLASIFICAR',
  telefono: '',
  contacto: '',
  condiciones: '',
};

/** Lee un campo de texto opcional del proveedor para el formulario (`null` -> ''). */
function texto(valor: string | null): string {
  return valor ?? '';
}

/**
 * Traduce la captura del formulario al cuerpo del API: los campos de texto
 * opcionales vacios se OMITEN (el backend los deja como null/sin cambio). El
 * `nombre` y el `tipo` siempre van.
 */
function aCuerpo(datos: DatosProveedorFormulario): ProveedorCrear {
  const cuerpo: ProveedorCrear = { nombre: datos.nombre, tipo: datos.tipo };
  if (datos.razonSocial.length > 0) {
    cuerpo.razonSocial = datos.razonSocial;
  }
  if (datos.telefono.length > 0) {
    cuerpo.telefono = datos.telefono;
  }
  if (datos.contacto.length > 0) {
    cuerpo.contacto = datos.contacto;
  }
  if (datos.condiciones.length > 0) {
    cuerpo.condiciones = datos.condiciones;
  }
  return cuerpo;
}

/**
 * Dialogo de alta y edicion de proveedor (react-hook-form + Zod), replica del
 * patron de Almacenes. Si recibe un `proveedor` edita (PATCH); si no, da de alta
 * (POST). Al guardar con exito cierra y avisa con un toast; el error del servidor
 * se muestra como toast con el mensaje en español del backend. La validacion de
 * captura es solo UX: el backend re-valida y es la autoridad (A1).
 */
export function DialogoProveedor({
  abierto,
  alCambiarAbierto,
  proveedor,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Proveedor a editar; `undefined` -> alta. */
  proveedor: Proveedor | undefined;
}): React.JSX.Element {
  const esEdicion = proveedor !== undefined;
  const crear = useCrearProveedor();
  const actualizar = useActualizarProveedor();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosProveedorFormulario>({
    resolver: zodResolver(esquemaProveedorFormulario),
    defaultValues: VALORES_INICIALES,
  });

  // Al abrir, sincroniza el formulario con el proveedor en edicion (o lo limpia).
  useEffect(() => {
    if (abierto) {
      formulario.reset(
        proveedor
          ? {
              nombre: proveedor.nombre,
              razonSocial: texto(proveedor.razonSocial),
              tipo: proveedor.tipo,
              telefono: texto(proveedor.telefono),
              contacto: texto(proveedor.contacto),
              condiciones: texto(proveedor.condiciones),
            }
          : VALORES_INICIALES,
      );
    }
  }, [abierto, proveedor, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const cuerpo = aCuerpo(datos);
    if (esEdicion) {
      actualizar.mutate(
        { id: proveedor.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Proveedor "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Proveedor "${resultado.nombre}" creado.`);
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
            <DialogTitle>{esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos de este proveedor.'
                : 'Captura los datos del nuevo proveedor del catálogo.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="proveedor-nombre">Nombre</FieldLabel>
              <Input
                id="proveedor-nombre"
                autoFocus
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.tipo)}>
              <FieldLabel htmlFor="proveedor-tipo">Tipo</FieldLabel>
              <SelectNativo
                id="proveedor-tipo"
                aria-invalid={Boolean(errors.tipo)}
                disabled={guardando}
                {...formulario.register('tipo')}
              >
                {TIPOS_PROVEEDOR.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {ETIQUETAS_TIPO_PROVEEDOR[tipo]}
                  </option>
                ))}
              </SelectNativo>
              <FieldError errors={[errors.tipo]} />
            </Field>

            <Field data-invalid={Boolean(errors.razonSocial)}>
              <FieldLabel htmlFor="proveedor-razon-social">Razón social</FieldLabel>
              <Input
                id="proveedor-razon-social"
                aria-invalid={Boolean(errors.razonSocial)}
                disabled={guardando}
                {...formulario.register('razonSocial')}
              />
              <FieldError errors={[errors.razonSocial]} />
            </Field>

            <Field data-invalid={Boolean(errors.contacto)}>
              <FieldLabel htmlFor="proveedor-contacto">Contacto</FieldLabel>
              <Input
                id="proveedor-contacto"
                aria-invalid={Boolean(errors.contacto)}
                disabled={guardando}
                {...formulario.register('contacto')}
              />
              <FieldError errors={[errors.contacto]} />
            </Field>

            <Field data-invalid={Boolean(errors.telefono)}>
              <FieldLabel htmlFor="proveedor-telefono">Teléfono</FieldLabel>
              <Input
                id="proveedor-telefono"
                aria-invalid={Boolean(errors.telefono)}
                disabled={guardando}
                {...formulario.register('telefono')}
              />
              <FieldError errors={[errors.telefono]} />
            </Field>

            <Field data-invalid={Boolean(errors.condiciones)}>
              <FieldLabel htmlFor="proveedor-condiciones">Condiciones</FieldLabel>
              <Input
                id="proveedor-condiciones"
                aria-invalid={Boolean(errors.condiciones)}
                disabled={guardando}
                {...formulario.register('condiciones')}
              />
              <FieldError errors={[errors.condiciones]} />
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
            <Button type="submit" disabled={guardando} data-testid="guardar-proveedor">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear proveedor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
