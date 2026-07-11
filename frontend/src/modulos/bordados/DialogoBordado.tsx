import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useActualizarBordado, useCrearBordado } from '@/api/bordados';
import type { Bordado, BordadoCrear, BordadoEditar } from '@/api/bordados';
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

import { FotoBordado } from './FotoBordado';
import {
  type DatosBordadoFormulario,
  ETIQUETAS_TIPO_BORDADO,
  esquemaBordadoFormulario,
  numeroOpcionalACuerpo,
  TIPOS_BORDADO,
} from './esquemas';

/** Valores por defecto de un alta (todo vacio; tipo BORDADO). */
const VALORES_INICIALES: DatosBordadoFormulario = {
  nombre: '',
  tipo: 'BORDADO',
  descripcion: '',
  puntadas: '',
  precio: '',
};

/**
 * Traduce la captura al cuerpo del API en ALTA (POST): los opcionales vacios se OMITEN
 * (el backend los deja en null). `tipo` siempre va; los numericos se convierten.
 */
function aCuerpoCrear(datos: DatosBordadoFormulario): BordadoCrear {
  const cuerpo: BordadoCrear = { nombre: datos.nombre, tipo: datos.tipo };
  if (datos.descripcion.length > 0) {
    cuerpo.descripcion = datos.descripcion;
  }
  const puntadas = numeroOpcionalACuerpo(datos.puntadas);
  if (puntadas !== undefined) {
    cuerpo.puntadas = puntadas;
  }
  const precio = numeroOpcionalACuerpo(datos.precio);
  if (precio !== undefined) {
    cuerpo.precio = precio;
  }
  return cuerpo;
}

/**
 * Traduce la captura al cuerpo del PATCH (EDICION): a diferencia del alta, los
 * opcionales que quedan VACIOS viajan como `null` para BORRAR el dato (M1) — en un
 * PATCH parcial un campo OMITIDO no se tocaria. `nombre` y `tipo` siempre van.
 */
function aCuerpoEditar(datos: DatosBordadoFormulario): BordadoEditar {
  return {
    nombre: datos.nombre,
    tipo: datos.tipo,
    descripcion: datos.descripcion.length > 0 ? datos.descripcion : null,
    puntadas: numeroOpcionalACuerpo(datos.puntadas) ?? null,
    precio: numeroOpcionalACuerpo(datos.precio) ?? null,
  };
}

/**
 * Dialogo de alta y edicion de bordado/estampado (react-hook-form + Zod), replica del
 * patron de Almacenes/Cortadores. Si recibe un `bordado` edita (PATCH); si no, da de
 * alta (POST). La FOTO solo se gestiona en EDICION (necesita el id del bordado): se
 * monta `FotoBordado` (sobre el componente reutilizable `SubidaImagen`); en alta se
 * muestra un aviso para guardar primero. La validacion de captura es solo UX: el
 * backend re-valida y es la autoridad (A1).
 */
export function DialogoBordado({
  abierto,
  alCambiarAbierto,
  bordado,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Bordado a editar; `undefined` -> alta. */
  bordado: Bordado | undefined;
}): React.JSX.Element {
  const esEdicion = bordado !== undefined;
  const crear = useCrearBordado();
  const actualizar = useActualizarBordado();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosBordadoFormulario>({
    resolver: zodResolver(esquemaBordadoFormulario),
    defaultValues: VALORES_INICIALES,
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(
        bordado
          ? {
              nombre: bordado.nombre,
              tipo: bordado.tipo,
              descripcion: bordado.descripcion ?? '',
              // Los campos numericos se editan como texto (vacio si no hay valor).
              puntadas: bordado.puntadas === null ? '' : String(bordado.puntadas),
              precio: bordado.precio === null ? '' : String(bordado.precio),
            }
          : VALORES_INICIALES,
      );
    }
  }, [abierto, bordado, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      actualizar.mutate(
        { id: bordado.id, cuerpo: aCuerpoEditar(datos) },
        {
          onSuccess: (resultado) => {
            toast.success(`Bordado "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(aCuerpoCrear(datos), {
      onSuccess: (resultado) => {
        toast.success(`Bordado "${resultado.nombre}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar bordado' : 'Nuevo bordado'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos de este bordado/estampado.'
                : 'Captura los datos del nuevo bordado/estampado del catálogo.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto py-4 pr-1">
            <FieldGroup>
              <LeyendaObligatorios />
              <Field data-invalid={Boolean(errors.nombre)}>
                <FieldLabel htmlFor="bordado-nombre" required>
                  Nombre
                </FieldLabel>
                <Input
                  id="bordado-nombre"
                  autoFocus
                  placeholder="Ej. Logo Marilyn pecho izq."
                  aria-invalid={Boolean(errors.nombre)}
                  disabled={guardando}
                  {...registrar('nombre')}
                />
                <FieldError errors={[errors.nombre]} />
              </Field>

              <Field data-invalid={Boolean(errors.tipo)}>
                <FieldLabel htmlFor="bordado-tipo">Tipo</FieldLabel>
                <SelectNativo
                  id="bordado-tipo"
                  aria-invalid={Boolean(errors.tipo)}
                  disabled={guardando}
                  {...registrar('tipo')}
                >
                  {TIPOS_BORDADO.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {ETIQUETAS_TIPO_BORDADO[tipo]}
                    </option>
                  ))}
                </SelectNativo>
                <FieldError errors={[errors.tipo]} />
              </Field>

              <Field data-invalid={Boolean(errors.puntadas)}>
                <FieldLabel htmlFor="bordado-puntadas">Puntadas</FieldLabel>
                <Input
                  id="bordado-puntadas"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="Ej. 8500"
                  aria-invalid={Boolean(errors.puntadas)}
                  disabled={guardando}
                  {...registrar('puntadas')}
                />
                <FieldDescription>Informativo (alimenta el costeo del bordado).</FieldDescription>
                <FieldError errors={[errors.puntadas]} />
              </Field>

              <Field data-invalid={Boolean(errors.precio)}>
                <FieldLabel htmlFor="bordado-precio">Precio de referencia</FieldLabel>
                <Input
                  id="bordado-precio"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="Ej. 12.00"
                  aria-invalid={Boolean(errors.precio)}
                  disabled={guardando}
                  {...registrar('precio')}
                />
                <FieldError errors={[errors.precio]} />
              </Field>

              <Field data-invalid={Boolean(errors.descripcion)}>
                <FieldLabel htmlFor="bordado-descripcion">Descripción</FieldLabel>
                <Input
                  id="bordado-descripcion"
                  placeholder="Ej. 3 tintas, frente izquierdo"
                  aria-invalid={Boolean(errors.descripcion)}
                  disabled={guardando}
                  {...registrar('descripcion')}
                />
                <FieldError errors={[errors.descripcion]} />
              </Field>

              {/* Foto: solo en edicion (necesita el id del bordado). */}
              <Field>
                <FieldLabel>Foto</FieldLabel>
                {esEdicion ? (
                  <FotoBordado bordado={bordado} deshabilitado={guardando} />
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="foto-aviso-alta">
                    Guarda el bordado primero para poder subir su foto.
                  </p>
                )}
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
            <Button
              type="submit"
              disabled={guardando}
              data-testid="guardar-bordado"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear bordado'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
