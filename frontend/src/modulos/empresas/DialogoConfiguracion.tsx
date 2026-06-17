import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  type DatosConfiguracionEmpresa,
  esquemaConfiguracionEmpresa,
  numeroOpcionalACuerpo,
} from '@/api/esquemas';
import { useActualizarConfiguracion, useConfiguracionEmpresa } from '@/api/empresas';
import type { Empresa, EmpresaConfiguracion, EmpresaConfiguracionEditar } from '@/api/tipos';
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
import { Skeleton } from '@/components/ui/skeleton';

/** Formulario vacio (todo sin valor). */
const VALORES_VACIOS: DatosConfiguracionEmpresa = {
  utilidadSugerida: '',
  regaliasBase: '',
  colchonCostura: '',
  fechaInventarioTelas: '',
  fechaInventarioPt: '',
  idAlmacenPtDefault: '',
};

/** Numero a texto para el `<input>` (`null`/`undefined` -> ''). */
function num(valor: number | null): string {
  return valor === null ? '' : String(valor);
}

/** ISO date-time a `YYYY-MM-DD` para el `<input type="date">` (`null` -> ''). */
function fecha(valor: string | null): string {
  return valor === null ? '' : valor.slice(0, 10);
}

/** Texto del `<input type="date">` a ISO (medianoche UTC) o `null` si esta vacio. */
function fechaACuerpo(valor: string): string | null {
  const texto = valor.trim();
  return texto === '' ? null : new Date(`${texto}T00:00:00.000Z`).toISOString();
}

/** Numero opcional a `number | null` (vacio = `null`, para limpiar el valor). */
function numeroANull(valor: string): number | null {
  return numeroOpcionalACuerpo(valor) ?? null;
}

/** Forma del formulario a partir de la configuracion del API. */
function aFormulario(config: EmpresaConfiguracion): DatosConfiguracionEmpresa {
  return {
    utilidadSugerida: num(config.utilidadSugerida),
    regaliasBase: num(config.regaliasBase),
    colchonCostura: num(config.colchonCostura),
    fechaInventarioTelas: fecha(config.fechaInventarioTelas),
    fechaInventarioPt: fecha(config.fechaInventarioPt),
    idAlmacenPtDefault: num(config.idAlmacenPtDefault),
  };
}

/**
 * Dialogo de CONFIGURACION por empresa (seccion secundaria de Empresas). Lee la
 * configuracion (`GET .../configuracion`) y la edita (`PATCH`). Los decimales se
 * capturan con el patron oficial `numeroOpcional` (texto; vacio = limpiar), las
 * fechas como `<input type="date">` y el almacen PT por defecto como id. El foco
 * de E1 es el CRUD; esta seccion cubre la configuracion de forma directa
 * (sin selector de almacen aun: se captura el id; un selector llegara cuando se
 * crucen los modulos). El backend valida y es la autoridad (A1).
 */
export function DialogoConfiguracion({
  empresa,
  alCerrar,
}: {
  /** Empresa cuya configuracion se edita; `null` -> dialogo cerrado. */
  empresa: Empresa | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const consulta = useConfiguracionEmpresa(empresa?.id ?? null);
  const actualizar = useActualizarConfiguracion();

  const formulario = useForm<DatosConfiguracionEmpresa>({
    resolver: zodResolver(esquemaConfiguracionEmpresa),
    defaultValues: VALORES_VACIOS,
  });

  // Cuando llega la configuracion, vuelca sus valores al formulario.
  useEffect(() => {
    if (consulta.data) {
      formulario.reset(aFormulario(consulta.data));
    }
  }, [consulta.data, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (empresa === null) {
      return;
    }
    const cuerpo: EmpresaConfiguracionEditar = {
      utilidadSugerida: numeroANull(datos.utilidadSugerida),
      regaliasBase: numeroANull(datos.regaliasBase),
      colchonCostura: numeroANull(datos.colchonCostura),
      fechaInventarioTelas: fechaACuerpo(datos.fechaInventarioTelas),
      fechaInventarioPt: fechaACuerpo(datos.fechaInventarioPt),
      idAlmacenPtDefault: numeroANull(datos.idAlmacenPtDefault),
    };
    actualizar.mutate(
      { id: empresa.id, cuerpo },
      {
        onSuccess: () => {
          toast.success(`Configuración de "${empresa.nombre}" guardada.`);
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  });

  const { errors } = formulario.formState;

  return (
    <Dialog
      open={empresa !== null}
      onOpenChange={(abierto) => {
        if (!abierto) {
          alCerrar();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configuración de {empresa?.nombre}</DialogTitle>
          <DialogDescription>
            Parámetros de costeo e inventario propios de esta empresa.
          </DialogDescription>
        </DialogHeader>

        {consulta.isPending ? (
          <div className="flex flex-col gap-3 py-4" data-testid="config-cargando">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : consulta.isError ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-destructive">{consulta.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void consulta.refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void enviar(e)} noValidate>
            <FieldGroup className="py-2">
              <Field data-invalid={Boolean(errors.utilidadSugerida)}>
                <FieldLabel htmlFor="config-utilidad">Utilidad sugerida</FieldLabel>
                <Input
                  id="config-utilidad"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  aria-invalid={Boolean(errors.utilidadSugerida)}
                  disabled={actualizar.isPending}
                  {...formulario.register('utilidadSugerida')}
                />
                <FieldError errors={[errors.utilidadSugerida]} />
              </Field>

              <Field data-invalid={Boolean(errors.regaliasBase)}>
                <FieldLabel htmlFor="config-regalias">Regalías base</FieldLabel>
                <Input
                  id="config-regalias"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  aria-invalid={Boolean(errors.regaliasBase)}
                  disabled={actualizar.isPending}
                  {...formulario.register('regaliasBase')}
                />
                <FieldError errors={[errors.regaliasBase]} />
              </Field>

              <Field data-invalid={Boolean(errors.colchonCostura)}>
                <FieldLabel htmlFor="config-colchon">Colchón de costura</FieldLabel>
                <Input
                  id="config-colchon"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  aria-invalid={Boolean(errors.colchonCostura)}
                  disabled={actualizar.isPending}
                  {...formulario.register('colchonCostura')}
                />
                <FieldError errors={[errors.colchonCostura]} />
              </Field>

              <Field data-invalid={Boolean(errors.fechaInventarioTelas)}>
                <FieldLabel htmlFor="config-fecha-telas">Fecha de inventario de telas</FieldLabel>
                <Input
                  id="config-fecha-telas"
                  type="date"
                  aria-invalid={Boolean(errors.fechaInventarioTelas)}
                  disabled={actualizar.isPending}
                  {...formulario.register('fechaInventarioTelas')}
                />
                <FieldError errors={[errors.fechaInventarioTelas]} />
              </Field>

              <Field data-invalid={Boolean(errors.fechaInventarioPt)}>
                <FieldLabel htmlFor="config-fecha-pt">Fecha de inventario de PT</FieldLabel>
                <Input
                  id="config-fecha-pt"
                  type="date"
                  aria-invalid={Boolean(errors.fechaInventarioPt)}
                  disabled={actualizar.isPending}
                  {...formulario.register('fechaInventarioPt')}
                />
                <FieldError errors={[errors.fechaInventarioPt]} />
              </Field>

              <Field data-invalid={Boolean(errors.idAlmacenPtDefault)}>
                <FieldLabel htmlFor="config-almacen-pt">Almacén PT por defecto (id)</FieldLabel>
                <Input
                  id="config-almacen-pt"
                  type="number"
                  step="1"
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.idAlmacenPtDefault)}
                  disabled={actualizar.isPending}
                  {...formulario.register('idAlmacenPtDefault')}
                />
                <FieldError errors={[errors.idAlmacenPtDefault]} />
              </Field>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={alCerrar}
                disabled={actualizar.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={actualizar.isPending}
                data-testid="guardar-configuracion"
              >
                {actualizar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                Guardar configuración
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
