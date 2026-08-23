import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  type DatosAlmacenFormulario,
  ETIQUETAS_TIPO_ALMACEN,
  esquemaAlmacenFormulario,
  TIPOS_ALMACEN,
} from '@/api/esquemas';
import { useActualizarAlmacen, useCrearAlmacen } from '@/api/almacenes';
import { COD_ROL_PROVEEDOR, useProveedoresPorRol } from '@/api/proveedores';
import type { Almacen } from '@/api/tipos';
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

/**
 * Dialogo de alta y edicion de almacen (react-hook-form + Zod). Si recibe un
 * `almacen` edita (PATCH); si no, da de alta (POST). Al guardar con exito cierra
 * y avisa con un toast; el error del servidor (validacion, conflicto de nombre,
 * permiso) se muestra como toast con el mensaje en español del backend.
 *
 * La validacion de captura es solo UX: el backend re-valida y es la autoridad.
 *
 * El CORTADOR (§Post-F9.13) va como estado local, no como campo del schema: solo aplica a los
 * almacenes de TELA y el backend lo valida a fondo (tipo, rol `corte` y un cortador = un almacén).
 */
export function DialogoAlmacen({
  abierto,
  alCambiarAbierto,
  almacen,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Almacen a editar; `undefined` -> alta. */
  almacen: Almacen | undefined;
}): React.JSX.Element {
  const esEdicion = almacen !== undefined;
  const crear = useCrearAlmacen();
  const actualizar = useActualizarAlmacen();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosAlmacenFormulario>({
    resolver: zodResolver(esquemaAlmacenFormulario),
    defaultValues: { nombre: '', tipo: 'PT' },
  });

  // Cortador ligado (§Post-F9.13). Estado local: no es texto del schema y solo aplica a TELA.
  const [idCortador, setIdCortador] = useState<number | null>(null);
  const tipoElegido = formulario.watch('tipo');
  const esDeTela = tipoElegido === 'TELA';

  // Solo terceros con el rol "corte" (el backend exige lo mismo).
  const cortadores = useProveedoresPorRol(COD_ROL_PROVEEDOR.corte);
  const listaCortadores = cortadores.data?.datos ?? [];
  // El cortador ya ligado se conserva como opción aunque no venga en la página cargada.
  const ligadoFueraDeLista =
    idCortador !== null && !listaCortadores.some((p) => p.id === idCortador);

  // Al abrir, sincroniza el formulario con el almacen en edicion (o lo limpia
  // para un alta). `reset` corre solo cuando cambia la apertura o el almacen.
  useEffect(() => {
    if (abierto) {
      formulario.reset(
        almacen ? { nombre: almacen.nombre, tipo: almacen.tipo } : { nombre: '', tipo: 'PT' },
      );
      setIdCortador(almacen?.idCortador ?? null);
    }
  }, [abierto, almacen, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    // Fuera de TELA la liga no existe: se manda null explícito para no dejar una liga huérfana
    // si el usuario cambió el tipo de un almacén que ya tenía cortador.
    const cortador = datos.tipo === 'TELA' ? idCortador : null;
    if (esEdicion) {
      actualizar.mutate(
        // En edición `idCortador` viaja SIEMPRE (incluido null): así se puede QUITAR la liga.
        { id: almacen.id, cuerpo: { ...datos, idCortador: cortador } },
        {
          onSuccess: (resultado) => {
            toast.success(`Almacén "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(
      { ...datos, ...(cortador === null ? {} : { idCortador: cortador }) },
      {
        onSuccess: (resultado) => {
          toast.success(`Almacén "${resultado.nombre}" creado.`);
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
            <DialogTitle>{esEdicion ? 'Editar almacén' : 'Nuevo almacén'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre o el tipo de este almacén.'
                : 'Captura los datos del nuevo almacén del catálogo.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="almacen-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="almacen-nombre"
                autoFocus
                placeholder="Ej. Bodega PT Central"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.tipo)}>
              <FieldLabel htmlFor="almacen-tipo">Tipo</FieldLabel>
              <SelectNativo
                id="almacen-tipo"
                aria-invalid={Boolean(errors.tipo)}
                disabled={guardando}
                {...formulario.register('tipo')}
              >
                {TIPOS_ALMACEN.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {ETIQUETAS_TIPO_ALMACEN[tipo]}
                  </option>
                ))}
              </SelectNativo>
              <FieldDescription>
                Qué guarda: PT = producto terminado · Telas · Avíos.
              </FieldDescription>
              <FieldError errors={[errors.tipo]} />
            </Field>

            {/* Cortador dueño del almacén (§Post-F9.13). Solo tiene sentido en TELA: es lo que
                hace que la descarga de tela salga por default de la bodega de ese taller. */}
            {esDeTela ? (
              <Field>
                <FieldLabel htmlFor="almacen-cortador">Cortador (opcional)</FieldLabel>
                <SelectNativo
                  id="almacen-cortador"
                  value={idCortador === null ? '' : String(idCortador)}
                  onChange={(e) =>
                    setIdCortador(e.target.value === '' ? null : Number(e.target.value))
                  }
                  disabled={guardando}
                  data-testid="almacen-cortador"
                >
                  <option value="">— Sin cortador —</option>
                  {ligadoFueraDeLista && idCortador !== null ? (
                    <option value={String(idCortador)}>
                      {almacen?.cortador ?? 'Cortador actual'}
                    </option>
                  ) : null}
                  {listaCortadores.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.nombre}
                    </option>
                  ))}
                </SelectNativo>
                <FieldDescription>
                  Si este almacén es el del taller de un cortador, ligarlo hace que al capturar su
                  corte la descarga de tela salga de aquí. Un cortador solo puede tener un almacén.
                </FieldDescription>
              </Field>
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
              disabled={guardando}
              data-testid="guardar-almacen"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear almacén'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
