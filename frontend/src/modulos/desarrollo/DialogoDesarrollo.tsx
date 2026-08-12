import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useCrearDesarrollo } from '@/api/desarrollos';
import { useCrearModelo } from '@/api/modelos';
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
  FieldLabel,
  LeyendaObligatorios,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { SelectorModelo } from '@/modulos/inventarios/SelectorModelo';

import { esquemaDesarrolloFormulario, type DatosDesarrolloFormulario } from './esquemas';

/** Valores por defecto (liga un modelo existente por defecto). */
const VALORES_INICIALES: DatosDesarrolloFormulario = {
  modo: 'existente',
  idModelo: '',
  codigoNuevo: '',
  descripcionNuevo: '',
  numeroCliente: '',
  notas: '',
};

/**
 * Diálogo para AGREGAR un desarrollo a un proyecto (F8-E2). Dos caminos:
 *  • "modelo existente" — se elige un modelo del catálogo (`idModelo`) y se crea el desarrollo.
 *  • "modelo nuevo" — el FRONTEND orquesta DOS llamadas: primero crea el Modelo (con su código y
 *    descripción) reusando el endpoint de Modelos y, con el `id` resultante, crea el desarrollo. La
 *    lógica de creación de modelos NO se duplica en el dominio de desarrollo (un modelo sin
 *    desarrollo es válido, así que si el segundo paso fallara no pasa nada grave).
 */
export function DialogoDesarrollo({
  abierto,
  alCambiarAbierto,
  idProyecto,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idProyecto: number;
}): React.JSX.Element {
  const crearDesarrollo = useCrearDesarrollo();
  const crearModelo = useCrearModelo();
  const guardando = crearDesarrollo.isPending || crearModelo.isPending;

  const formulario = useForm<DatosDesarrolloFormulario>({
    resolver: zodResolver(esquemaDesarrolloFormulario),
    defaultValues: VALORES_INICIALES,
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(VALORES_INICIALES);
    }
  }, [abierto, formulario]);

  const modo = formulario.watch('modo');
  const idModeloElegido = formulario.watch('idModelo');

  const enviar = formulario.handleSubmit((datos) => {
    void (async () => {
      try {
        // Paso 1: resolver el id del modelo (existente o creando uno nuevo).
        let idModelo: number;
        if (datos.modo === 'nuevo') {
          const modelo = await crearModelo.mutateAsync({
            codigo: datos.codigoNuevo.trim(),
            ...(datos.descripcionNuevo.trim() === ''
              ? {}
              : { descripcion: datos.descripcionNuevo.trim() }),
          });
          idModelo = modelo.id;
        } else {
          idModelo = Number(datos.idModelo);
        }

        // Paso 2: crear el desarrollo ligando ese modelo.
        await crearDesarrollo.mutateAsync({
          idProyecto,
          cuerpo: {
            idModelo,
            ...(datos.numeroCliente.trim() === ''
              ? {}
              : { numeroCliente: datos.numeroCliente.trim() }),
            ...(datos.notas.trim() === '' ? {} : { notas: datos.notas }),
          },
        });
        toast.success('Desarrollo agregado.');
        alCambiarAbierto(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudo agregar el desarrollo.');
      }
    })();
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>Agregar desarrollo</DialogTitle>
            <DialogDescription>
              Elige un modelo del catálogo o crea uno nuevo. El desarrollo lleva DOS números: el
              nuestro (código del modelo) y el del cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4 pr-1">
            <LeyendaObligatorios />
            {/* Selector de modo (existente / nuevo). */}
            <Field>
              <FieldLabel htmlFor="desarrollo-modo">Modelo</FieldLabel>
              <SelectNativo id="desarrollo-modo" disabled={guardando} {...registrar('modo')}>
                <option value="existente">Elegir un modelo existente</option>
                <option value="nuevo">Crear un modelo nuevo</option>
              </SelectNativo>
            </Field>

            {modo === 'existente' ? (
              <Field data-invalid={Boolean(errors.idModelo)}>
                <FieldLabel htmlFor="desarrollo-modelo" required>
                  Modelo del catálogo
                </FieldLabel>
                {/* Buscador SERVER-SIDE (Daniel, ago-2026): el catálogo tiene ~5,000 modelos, y un
                    `<select>` con la primera página (tope 100) sólo enseñaba el 2% y el modelo recién
                    dado de alta no aparecía. El {@link SelectorModelo} busca por código o descripción
                    en el servidor y sin teclear nada ya ofrece los primeros del catálogo. */}
                <SelectorModelo
                  idSeleccionado={idModeloElegido === '' ? undefined : Number(idModeloElegido)}
                  alSeleccionar={(m) =>
                    formulario.setValue('idModelo', String(m.id), { shouldValidate: true })
                  }
                  alLimpiar={() => formulario.setValue('idModelo', '', { shouldValidate: true })}
                  idInput="desarrollo-modelo"
                  testid="desarrollo-modelo"
                />
                <FieldDescription>
                  Busca por código o descripción (el catálogo completo, no sólo los primeros).
                </FieldDescription>
                <FieldError errors={[errors.idModelo]} />
              </Field>
            ) : (
              <>
                <Field data-invalid={Boolean(errors.codigoNuevo)}>
                  <FieldLabel htmlFor="desarrollo-codigo" required>
                    Código del modelo nuevo
                  </FieldLabel>
                  <Input
                    id="desarrollo-codigo"
                    placeholder="Ej. 4522"
                    disabled={guardando}
                    aria-invalid={Boolean(errors.codigoNuevo)}
                    {...registrar('codigoNuevo')}
                  />
                  <FieldDescription>
                    Nuestro número interno (el código del modelo).
                  </FieldDescription>
                  <FieldError errors={[errors.codigoNuevo]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="desarrollo-descripcion">Descripción</FieldLabel>
                  <Input
                    id="desarrollo-descripcion"
                    disabled={guardando}
                    {...registrar('descripcionNuevo')}
                  />
                </Field>
              </>
            )}

            <Field>
              <FieldLabel htmlFor="desarrollo-numero-cliente">Número del cliente</FieldLabel>
              <Input
                id="desarrollo-numero-cliente"
                placeholder="Ej. SKU-99812"
                disabled={guardando}
                {...registrar('numeroCliente')}
              />
              <FieldDescription>
                El número con el que el cliente identifica el modelo.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="desarrollo-notas">Notas</FieldLabel>
              <textarea
                id="desarrollo-notas"
                rows={2}
                disabled={guardando}
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
                {...registrar('notas')}
              />
            </Field>
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
              data-testid="guardar-desarrollo"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Agregar desarrollo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
