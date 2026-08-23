import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  type DatosEtiquetaMarcaFormulario,
  esquemaEtiquetaMarcaFormulario,
  numeroOpcionalACuerpo,
} from '@/api/esquemas';
import { useActualizarEtiquetaMarca, useCrearEtiquetaMarca } from '@/api/etiquetas-marca';
import type { EtiquetaMarca, EtiquetaMarcaCrear } from '@/api/tipos';
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

/** Valores por defecto de un alta (nombre vacio; regalías vacías = 0%). */
const VALORES_INICIALES: DatosEtiquetaMarcaFormulario = {
  nombre: '',
  regalias: '',
};

/**
 * Traduce la captura al cuerpo del API: `regalias` se captura como texto; si trae
 * numero se convierte y se envia, si esta vacio se omite (el backend lo deja en
 * 0%). El `nombre` siempre va.
 */
function aCuerpo(datos: DatosEtiquetaMarcaFormulario): EtiquetaMarcaCrear {
  const cuerpo: EtiquetaMarcaCrear = { nombre: datos.nombre };
  const regalias = numeroOpcionalACuerpo(datos.regalias);
  if (regalias !== undefined) {
    cuerpo.regalias = regalias;
  }
  return cuerpo;
}

/**
 * Dialogo de alta y edicion de etiqueta de marca (react-hook-form + Zod), replica
 * del patron de Almacenes. Si recibe una `etiqueta` edita (PATCH); si no, da de
 * alta (POST). La validacion de captura (regalías 0–100) es solo UX: el backend
 * re-valida y, si el porcentaje esta fuera de rango, responde con un toast (A1).
 */
export function DialogoEtiquetaMarca({
  abierto,
  alCambiarAbierto,
  etiqueta,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Etiqueta a editar; `undefined` -> alta. */
  etiqueta: EtiquetaMarca | undefined;
}): React.JSX.Element {
  const esEdicion = etiqueta !== undefined;
  const crear = useCrearEtiquetaMarca();
  const actualizar = useActualizarEtiquetaMarca();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosEtiquetaMarcaFormulario>({
    resolver: zodResolver(esquemaEtiquetaMarcaFormulario),
    defaultValues: VALORES_INICIALES,
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(
        etiqueta
          ? // El campo numerico se edita como texto.
            { nombre: etiqueta.nombre, regalias: etiqueta.regalias.toString() }
          : VALORES_INICIALES,
      );
    }
  }, [abierto, etiqueta, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const cuerpo = aCuerpo(datos);
    if (esEdicion) {
      actualizar.mutate(
        { id: etiqueta.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Etiqueta "${resultado.nombre}" actualizada.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Etiqueta "${resultado.nombre}" creada.`);
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
              {esEdicion ? 'Editar etiqueta de marca' : 'Nueva etiqueta de marca'}
            </DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre o el porcentaje de regalías.'
                : 'Captura la etiqueta de marca y su porcentaje de regalías.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="etiqueta-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="etiqueta-nombre"
                autoFocus
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.regalias)}>
              <FieldLabel htmlFor="etiqueta-regalias">Regalías (%)</FieldLabel>
              <Input
                id="etiqueta-regalias"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                placeholder="0"
                aria-invalid={Boolean(errors.regalias)}
                disabled={guardando}
                {...formulario.register('regalias')}
              />
              <FieldDescription>Porcentaje entre 0 y 100.</FieldDescription>
              <FieldError errors={[errors.regalias]} />
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
            <Button type="submit" disabled={guardando} data-testid="guardar-etiqueta-marca">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear etiqueta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
