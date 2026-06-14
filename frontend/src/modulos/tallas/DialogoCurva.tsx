import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { type DatosCurvaFormulario, esquemaCurvaFormulario } from '@/api/esquemas';
import { useActualizarCurva, useCrearCurva, useTallasActivas } from '@/api/tallas';
import type { Curva, CurvaCrear, CurvaEditar } from '@/api/tipos';
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

import { ArmadorCurva } from './ArmadorCurva';

/** Valores por defecto de un alta (nombre vacio). */
const VALORES_INICIALES: DatosCurvaFormulario = { nombre: '' };

/**
 * Dialogo de alta y edicion de curva (react-hook-form + Zod). El `nombre` es texto del
 * schema; las tallas (≥1, EN ORDEN) se gestionan con el `ArmadorCurva` como estado
 * aparte (`idsTallas`) y se envian INLINE en el cuerpo del API (misma transaccion A2
 * en el backend). Si recibe una `curva` edita (PATCH); si no, da de alta (POST). La
 * validacion de captura es solo UX: el backend re-valida y es la autoridad (A1).
 */
export function DialogoCurva({
  abierto,
  alCambiarAbierto,
  curva,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Curva a editar; `undefined` -> alta. */
  curva: Curva | undefined;
}): React.JSX.Element {
  const esEdicion = curva !== undefined;
  const crear = useCrearCurva();
  const actualizar = useActualizarCurva();
  const guardando = crear.isPending || actualizar.isPending;
  const tallasCatalogo = useTallasActivas();

  // Tallas elegidas, EN ORDEN: estado local (no son texto del schema). Se validan al
  // enviar (≥1) y se envian inline en el cuerpo del API.
  const [idsTallas, setIdsTallas] = useState<number[]>([]);
  const [errorTallas, setErrorTallas] = useState<string | null>(null);

  const formulario = useForm<DatosCurvaFormulario>({
    resolver: zodResolver(esquemaCurvaFormulario),
    defaultValues: VALORES_INICIALES,
  });

  useEffect(() => {
    if (!abierto) {
      return;
    }
    setErrorTallas(null);
    if (curva) {
      formulario.reset({ nombre: curva.nombre });
      // Los items vienen ORDENADOS por posicion del API; se conservan tal cual.
      setIdsTallas(curva.items.map((item) => item.idTalla));
    } else {
      formulario.reset(VALORES_INICIALES);
      setIdsTallas([]);
    }
  }, [abierto, curva, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    // Validacion de captura (≥1 talla). El backend es la autoridad, pero asi el usuario
    // ve el error sin un viaje al servidor.
    if (idsTallas.length === 0) {
      setErrorTallas('Agrega al menos una talla a la curva.');
      return;
    }
    setErrorTallas(null);

    if (esEdicion) {
      // Los items SIEMPRE viajan (el usuario tiene ≥1; si no los tocó, son los que se
      // poblaron al abrir). Nunca `[]`.
      const cuerpo: CurvaEditar = { nombre: datos.nombre, items: idsTallas };
      actualizar.mutate(
        { id: curva.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Curva "${resultado.nombre}" actualizada.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    const cuerpo: CurvaCrear = { nombre: datos.nombre, items: idsTallas };
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Curva "${resultado.nombre}" creada.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar curva' : 'Nueva curva'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre y las tallas de esta curva.'
                : 'Nombra la curva y arma su conjunto de tallas en orden.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="curva-nombre">Nombre</FieldLabel>
              <Input
                id="curva-nombre"
                autoFocus
                placeholder="Ej. Dama básica"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <ArmadorCurva
              tallas={tallasCatalogo.data?.datos ?? []}
              cargando={tallasCatalogo.isPending}
              error={tallasCatalogo.isError ? tallasCatalogo.error.message : null}
              seleccionados={idsTallas}
              alCambiar={setIdsTallas}
              mensajeError={errorTallas}
              deshabilitado={guardando}
            />
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
            <Button type="submit" disabled={guardando} data-testid="guardar-curva">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear curva'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
