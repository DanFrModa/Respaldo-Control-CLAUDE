import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { type DatosEmpresaFormulario, esquemaEmpresaFormulario } from '@/api/esquemas';
import { useActualizarEmpresa, useCrearEmpresa } from '@/api/empresas';
import type { Empresa, EmpresaCrear } from '@/api/tipos';
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

/** Valores por defecto de un alta (texto vacio; banderas en estado aparte). */
const VALORES_INICIALES: DatosEmpresaFormulario = {
  nombre: '',
  razonSocial: '',
  identificador: '',
  upc: '',
};

/** Banderas booleanas de la empresa (se capturan como checkbox, fuera del schema de texto). */
interface Banderas {
  favorita: boolean;
  paraIpt: boolean;
  paraEdr: boolean;
}

const BANDERAS_INICIALES: Banderas = { favorita: false, paraIpt: false, paraEdr: false };

/** Lee un campo de texto opcional de la empresa para el formulario (`null` -> ''). */
function texto(valor: string | null): string {
  return valor ?? '';
}

/**
 * Dialogo de alta y edicion de empresa (react-hook-form + Zod). Captura nombre,
 * razon social, identificador (RFC), **UPC** (clave: lo usara E5) y las banderas
 * favorita/IPT/EDR. Si recibe una `empresa` edita (PATCH); si no, da de alta
 * (POST). La validacion de captura es solo UX: el backend re-valida y es la
 * autoridad (A1).
 */
export function DialogoEmpresa({
  abierto,
  alCambiarAbierto,
  empresa,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Empresa a editar; `undefined` -> alta. */
  empresa: Empresa | undefined;
}): React.JSX.Element {
  const esEdicion = empresa !== undefined;
  const crear = useCrearEmpresa();
  const actualizar = useActualizarEmpresa();
  const guardando = crear.isPending || actualizar.isPending;

  const [banderas, setBanderas] = useState<Banderas>(BANDERAS_INICIALES);

  const formulario = useForm<DatosEmpresaFormulario>({
    resolver: zodResolver(esquemaEmpresaFormulario),
    defaultValues: VALORES_INICIALES,
  });

  // Al abrir, sincroniza el formulario y las banderas con la empresa (o limpia).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (empresa) {
      formulario.reset({
        nombre: empresa.nombre,
        razonSocial: texto(empresa.razonSocial),
        identificador: texto(empresa.identificador),
        upc: texto(empresa.upc),
      });
      setBanderas({
        favorita: empresa.favorita,
        paraIpt: empresa.paraIpt,
        paraEdr: empresa.paraEdr,
      });
    } else {
      formulario.reset(VALORES_INICIALES);
      setBanderas(BANDERAS_INICIALES);
    }
  }, [abierto, empresa, formulario]);

  function aCuerpo(datos: DatosEmpresaFormulario): EmpresaCrear {
    const cuerpo: EmpresaCrear = {
      nombre: datos.nombre,
      favorita: banderas.favorita,
      paraIpt: banderas.paraIpt,
      paraEdr: banderas.paraEdr,
    };
    if (datos.razonSocial.length > 0) {
      cuerpo.razonSocial = datos.razonSocial;
    }
    if (datos.identificador.length > 0) {
      cuerpo.identificador = datos.identificador;
    }
    if (datos.upc.length > 0) {
      cuerpo.upc = datos.upc;
    }
    return cuerpo;
  }

  const enviar = formulario.handleSubmit((datos) => {
    const cuerpo = aCuerpo(datos);
    if (esEdicion) {
      actualizar.mutate(
        { id: empresa.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Empresa "${resultado.nombre}" actualizada.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Empresa "${resultado.nombre}" creada.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;

  function alternarBandera(clave: keyof Banderas, valor: boolean): void {
    setBanderas((previo) => ({ ...previo, [clave]: valor }));
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar empresa' : 'Nueva empresa'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos de esta empresa.'
                : 'Captura los datos de la nueva empresa.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="empresa-nombre">Nombre</FieldLabel>
              <Input
                id="empresa-nombre"
                autoFocus
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.razonSocial)}>
              <FieldLabel htmlFor="empresa-razon-social">Razón social</FieldLabel>
              <Input
                id="empresa-razon-social"
                aria-invalid={Boolean(errors.razonSocial)}
                disabled={guardando}
                {...formulario.register('razonSocial')}
              />
              <FieldError errors={[errors.razonSocial]} />
            </Field>

            <Field data-invalid={Boolean(errors.identificador)}>
              <FieldLabel htmlFor="empresa-identificador">Identificador (RFC)</FieldLabel>
              <Input
                id="empresa-identificador"
                aria-invalid={Boolean(errors.identificador)}
                disabled={guardando}
                {...formulario.register('identificador')}
              />
              <FieldError errors={[errors.identificador]} />
            </Field>

            <Field data-invalid={Boolean(errors.upc)}>
              <FieldLabel htmlFor="empresa-upc">UPC</FieldLabel>
              <Input
                id="empresa-upc"
                aria-invalid={Boolean(errors.upc)}
                disabled={guardando}
                {...formulario.register('upc')}
              />
              <FieldDescription>
                Prefijo de código de barras de la empresa (se usará al generar los UPC de los
                modelos).
              </FieldDescription>
              <FieldError errors={[errors.upc]} />
            </Field>

            {/* Banderas */}
            <Field orientation="horizontal">
              <input
                id="empresa-favorita"
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={banderas.favorita}
                disabled={guardando}
                onChange={(e) => alternarBandera('favorita', e.target.checked)}
                data-testid="empresa-favorita"
              />
              <FieldLabel htmlFor="empresa-favorita" className="font-normal">
                Empresa favorita (predeterminada al iniciar sesión)
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <input
                id="empresa-ipt"
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={banderas.paraIpt}
                disabled={guardando}
                onChange={(e) => alternarBandera('paraIpt', e.target.checked)}
                data-testid="empresa-ipt"
              />
              <FieldLabel htmlFor="empresa-ipt" className="font-normal">
                Participa en el inventario de producto terminado (IPT)
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <input
                id="empresa-edr"
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={banderas.paraEdr}
                disabled={guardando}
                onChange={(e) => alternarBandera('paraEdr', e.target.checked)}
                data-testid="empresa-edr"
              />
              <FieldLabel htmlFor="empresa-edr" className="font-normal">
                Participa en el estado de resultados (EDR)
              </FieldLabel>
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
            <Button type="submit" disabled={guardando} data-testid="guardar-empresa">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear empresa'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
