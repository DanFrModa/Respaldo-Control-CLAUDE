import { zodResolver } from '@hookform/resolvers/zod';
import {
  CalendarIcon,
  HashIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  TypeIcon,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  useActualizarCampoCliente,
  useAgregarCampoCliente,
  useCamposCliente,
  useDesactivarCampoCliente,
  useReactivarCampoCliente,
} from '@/api/clientes';
import type {
  ClienteCampo,
  ClienteCampoCrear,
  ClienteCampoEditar,
  TipoCampoCliente,
} from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { EstadoPunto } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';

/** Orden y etiquetas legibles de los tipos de campo (D7). */
const TIPOS_CAMPO: readonly TipoCampoCliente[] = ['TEXTO', 'NUMERO', 'FECHA'];

/** Etiqueta para UI de cada tipo de dato del campo. */
const ETIQUETAS_TIPO_CAMPO: Record<TipoCampoCliente, string> = {
  TEXTO: 'Texto',
  NUMERO: 'Número',
  FECHA: 'Fecha',
};

/** Icono por tipo de campo (pista visual del dato esperado). */
const ICONO_TIPO_CAMPO: Record<TipoCampoCliente, LucideIcon> = {
  TEXTO: TypeIcon,
  NUMERO: HashIcon,
  FECHA: CalendarIcon,
};

/** Esquema de captura de un campo de referencia (solo UX; el backend re-valida, A1). */
const esquemaCampoFormulario = z.object({
  etiqueta: z
    .string()
    .trim()
    .min(1, { error: 'La etiqueta es obligatoria' })
    .max(100, { error: 'La etiqueta no puede tener más de 100 caracteres' }),
  tipo: z.enum(TIPOS_CAMPO),
  // `orden` se captura como texto (igual que los numéricos opcionales de Proveedor):
  // vacío = el backend lo coloca al final; un entero ≥0 fija la posición.
  orden: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), { error: 'El orden debe ser un número entero' }),
});

/** Datos del formulario de un campo. */
type DatosCampoFormulario = z.infer<typeof esquemaCampoFormulario>;

/**
 * Editor de los campos de referencia de un cliente (D7 — `DECISIONES.md` D7). Vive en
 * el panel de DETALLE del cliente (necesita su id), igual que el adjuntador de
 * proveedores. Permite agregar campos, editarlos (etiqueta/tipo), desactivarlos
 * (borrado suave, con confirmación) y reactivarlos. Muestra activos e inactivos (los
 * inactivos atenuados, con opción de reactivar). Toasts de éxito/error (sonner).
 *
 * El orden lo asigna el backend (al final); aquí no se reordena (queda para una mejora
 * posterior si el negocio lo pide). La unicidad de la etiqueta por cliente la decide el
 * backend (A1); si choca, el toast muestra su mensaje.
 */
export function EditorCamposCliente({
  idCliente,
  deshabilitado = false,
}: {
  idCliente: number;
  deshabilitado?: boolean;
}): React.JSX.Element {
  const consulta = useCamposCliente(idCliente);
  const desactivar = useDesactivarCampoCliente();
  const reactivar = useReactivarCampoCliente();

  // Diálogo de alta/edición de un campo.
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [campoEnEdicion, setCampoEnEdicion] = useState<ClienteCampo | undefined>(undefined);
  // Campo pendiente de confirmar su desactivación.
  const [aDesactivar, setADesactivar] = useState<ClienteCampo | null>(null);

  function abrirAlta(): void {
    setCampoEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(campo: ClienteCampo): void {
    setCampoEnEdicion(campo);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(
      { idCliente, idCampo: objetivo.id },
      {
        onSuccess: () => {
          toast.success(`Campo "${objetivo.etiqueta}" desactivado.`);
          setADesactivar(null);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  // Reactivar es NO destructivo: directo, sin confirmación.
  function reactivarCampo(campo: ClienteCampo): void {
    reactivar.mutate(
      { idCliente, idCampo: campo.id },
      {
        onSuccess: () => toast.success(`Campo "${campo.etiqueta}" activado.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const campos = consulta.data ?? [];

  return (
    <div className="space-y-3" data-testid="editor-campos-cliente">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Campos propios de este cliente (p. ej. su número de pedido). Se capturan al registrar una
          orden.
        </p>
        {deshabilitado ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={abrirAlta}
            data-testid="nuevo-campo"
          >
            <PlusIcon aria-hidden />
            Agregar campo
          </Button>
        )}
      </div>

      {consulta.isPending ? (
        <div className="space-y-2" data-testid="campos-cargando">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive">{consulta.error.message}</p>
      ) : campos.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="campos-vacio">
          Este cliente no tiene campos de referencia.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="lista-campos">
          {campos.map((campo) => {
            const Icono = ICONO_TIPO_CAMPO[campo.tipo];
            return (
              <li
                key={campo.id}
                data-testid="fila-campo"
                data-activo={campo.activo}
                className="flex items-center gap-3 rounded-lg border p-2.5"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
                >
                  <Icono className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{campo.etiqueta}</span>
                    {campo.activo ? null : <EstadoPunto activo={false} />}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {ETIQUETAS_TIPO_CAMPO[campo.tipo]}
                  </span>
                </div>
                {deshabilitado ? null : (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => abrirEdicion(campo)}
                      aria-label={`Editar campo ${campo.etiqueta}`}
                      data-testid="editar-campo"
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    {campo.activo ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setADesactivar(campo)}
                        aria-label={`Desactivar campo ${campo.etiqueta}`}
                        data-testid="desactivar-campo"
                      >
                        <PowerOffIcon className="text-destructive" aria-hidden />
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => reactivarCampo(campo)}
                        aria-label={`Activar campo ${campo.etiqueta}`}
                        data-testid="activar-campo"
                      >
                        <PowerIcon aria-hidden />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <DialogoCampo
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        idCliente={idCliente}
        campo={campoEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar campo"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el campo{' '}
            <span className="font-medium text-foreground">{aDesactivar?.etiqueta}</span>? Podrás
            volver a activarlo después.
          </>
        }
        textoConfirmar="Desactivar"
        variante="destructive"
        procesando={desactivar.isPending}
        alConfirmar={confirmarDesactivar}
      />
    </div>
  );
}

/** Valores por defecto de un alta de campo (orden vacío = al final). */
const VALORES_INICIALES_CAMPO: DatosCampoFormulario = { etiqueta: '', tipo: 'TEXTO', orden: '' };

/** Convierte el `orden` capturado (texto) a número, o `undefined` si viene vacío. */
function ordenACuerpo(valor: string): number | undefined {
  return valor === '' ? undefined : Number(valor);
}

/**
 * Diálogo de alta/edición de un campo de referencia (D7). Si recibe un `campo` edita
 * (PATCH etiqueta/tipo); si no, da de alta (POST). El backend asigna el orden y exige
 * la etiqueta única por cliente (A1). Al guardar con éxito cierra y avisa.
 */
function DialogoCampo({
  abierto,
  alCambiarAbierto,
  idCliente,
  campo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idCliente: number;
  /** Campo a editar; `undefined` -> alta. */
  campo: ClienteCampo | undefined;
}): React.JSX.Element {
  const esEdicion = campo !== undefined;
  const agregar = useAgregarCampoCliente();
  const actualizar = useActualizarCampoCliente();
  const guardando = agregar.isPending || actualizar.isPending;

  const formulario = useForm<DatosCampoFormulario>({
    resolver: zodResolver(esquemaCampoFormulario),
    defaultValues: VALORES_INICIALES_CAMPO,
  });

  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (campo) {
      formulario.reset({ etiqueta: campo.etiqueta, tipo: campo.tipo, orden: String(campo.orden) });
    } else {
      formulario.reset(VALORES_INICIALES_CAMPO);
    }
  }, [abierto, campo, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const orden = ordenACuerpo(datos.orden);

    if (esEdicion) {
      // Omitir `orden` (vacío) = no tocar la posición; con valor = fijarla.
      const cuerpo: ClienteCampoEditar = {
        etiqueta: datos.etiqueta,
        tipo: datos.tipo,
        ...(orden === undefined ? {} : { orden }),
      };
      actualizar.mutate(
        { idCliente, idCampo: campo.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Campo "${resultado.etiqueta}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    // Alta: `orden` vacío se OMITE (el backend lo coloca al final).
    const cuerpo: ClienteCampoCrear = {
      etiqueta: datos.etiqueta,
      tipo: datos.tipo,
      ...(orden === undefined ? {} : { orden }),
    };
    agregar.mutate(
      { idCliente, cuerpo },
      {
        onSuccess: (resultado) => {
          toast.success(`Campo "${resultado.etiqueta}" agregado.`);
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar campo' : 'Nuevo campo de referencia'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia la etiqueta o el tipo de este campo.'
                : 'Define un campo propio de este cliente (D7).'}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.etiqueta)}>
                <FieldLabel htmlFor="campo-etiqueta">Etiqueta</FieldLabel>
                <Input
                  id="campo-etiqueta"
                  autoFocus
                  aria-invalid={Boolean(errors.etiqueta)}
                  disabled={guardando}
                  placeholder="p. ej. No. de pedido del cliente"
                  {...registrar('etiqueta')}
                />
                <FieldError errors={[errors.etiqueta]} />
              </Field>

              <Field data-invalid={Boolean(errors.tipo)}>
                <FieldLabel htmlFor="campo-tipo">Tipo de dato</FieldLabel>
                <SelectNativo
                  id="campo-tipo"
                  aria-invalid={Boolean(errors.tipo)}
                  disabled={guardando}
                  {...registrar('tipo')}
                >
                  {TIPOS_CAMPO.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {ETIQUETAS_TIPO_CAMPO[tipo]}
                    </option>
                  ))}
                </SelectNativo>
                <FieldError errors={[errors.tipo]} />
              </Field>

              <Field data-invalid={Boolean(errors.orden)}>
                <FieldLabel htmlFor="campo-orden">Orden</FieldLabel>
                <Input
                  id="campo-orden"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.orden)}
                  disabled={guardando}
                  {...registrar('orden')}
                />
                <FieldDescription>Vacío = se coloca al final.</FieldDescription>
                <FieldError errors={[errors.orden]} />
              </Field>
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
            <Button type="submit" disabled={guardando} data-testid="guardar-campo">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Agregar campo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
