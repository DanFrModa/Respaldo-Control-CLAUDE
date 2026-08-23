import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useActualizarTipoProducto, useCrearTipoProducto } from '@/api/calidad';
import { esquemaTipoProductoFormulario, type DatosTipoProductoFormulario } from '@/api/esquemas';
import type { TipoProducto } from '@/api/tipos';
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

/**
 * Dialogo de alta y edicion de tipo de producto. Si recibe un `tipo` edita (PATCH);
 * si no, da de alta (POST). Validacion solo de UX: el backend re-valida (A1).
 *
 * ⚠️ Además del nombre captura el **dígito de concepto** (V1-E3n): el 1er dígito del código de
 * producción de los modelos de este tipo (§Post-F9.34). Sin él, dar de alta un tipo aquí y luego
 * elegirlo al desarrollar un modelo terminaba en *"captúralo en su catálogo"* — un catálogo que no
 * tenía el campo. Vaciarlo lo quita; el dígito es único entre los tipos activos (lo valida el
 * backend y lo respalda un índice parcial).
 */
export function DialogoTipoProducto({
  abierto,
  alCambiarAbierto,
  tipo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  tipo: TipoProducto | undefined;
}): React.JSX.Element {
  const esEdicion = tipo !== undefined;
  const crear = useCrearTipoProducto();
  const actualizar = useActualizarTipoProducto();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosTipoProductoFormulario>({
    resolver: zodResolver(esquemaTipoProductoFormulario),
    defaultValues: { nombre: '', digitoConcepto: '' },
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(
        tipo
          ? {
              nombre: tipo.nombre,
              digitoConcepto: tipo.digitoConcepto === null ? '' : String(tipo.digitoConcepto),
            }
          : { nombre: '', digitoConcepto: '' },
      );
    }
  }, [abierto, tipo, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const digito = datos.digitoConcepto.trim();
    if (esEdicion) {
      actualizar.mutate(
        // En edición el vacío viaja como `null` para QUITAR el dígito (M1).
        {
          id: tipo.id,
          cuerpo: { nombre: datos.nombre, digitoConcepto: digito === '' ? null : Number(digito) },
        },
        {
          onSuccess: (resultado) => {
            toast.success(`Tipo "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    // En el alta el vacío se OMITE (el backend lo deja en null).
    crear.mutate(
      {
        nombre: datos.nombre,
        ...(digito === '' ? {} : { digitoConcepto: Number(digito) }),
      },
      {
        onSuccess: (resultado) => {
          toast.success(`Tipo "${resultado.nombre}" creado.`);
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  });

  const { errors } = formulario.formState;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent>
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>
              {esEdicion ? 'Editar tipo de producto' : 'Nuevo tipo de producto'}
            </DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre de este tipo de producto.'
                : 'Captura el nombre del nuevo tipo de producto.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="tipo-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="tipo-nombre"
                autoFocus
                placeholder="Ej. Playera"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.digitoConcepto)}>
              <FieldLabel htmlFor="tipo-digito-concepto">Dígito de concepto</FieldLabel>
              <Input
                id="tipo-digito-concepto"
                inputMode="numeric"
                maxLength={1}
                className="mono w-20"
                placeholder="Ej. 8"
                aria-invalid={Boolean(errors.digitoConcepto)}
                disabled={guardando}
                data-testid="tipo-digito-concepto"
                {...formulario.register('digitoConcepto')}
              />
              <FieldDescription>
                El <b>primer dígito</b> del código de producción de los modelos de este tipo
                (chamarra 8, gorra 9…). Del 2 al 9, y no se repite entre tipos activos. Déjalo vacío
                si este tipo no se numera — pero entonces sus modelos no podrán salir a producción.
              </FieldDescription>
              <FieldError errors={[errors.digitoConcepto]} />
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
              data-testid="guardar-tipo-producto"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear tipo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
