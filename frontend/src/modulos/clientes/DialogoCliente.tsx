import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { useActualizarCliente, useCrearCliente } from '@/api/clientes';
import type { Cliente, ClienteCrear, ClienteEditar } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AvisoAlta } from '@/components/ui/aviso-alta';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  LeyendaObligatorios,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * Esquema de captura del formulario de cliente (solo UX; el backend re-valida y es la
 * autoridad, A1). Todo se captura como texto: `nombre` obligatorio; contacto/teléfono/
 * email/dirección opcionales. El `email`, si se escribe, debe ser válido (mismo
 * criterio que el backend). Los topes de longitud reflejan los del contrato.
 */
const esquemaClienteFormulario = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(200, { error: 'El nombre no puede tener más de 200 caracteres' }),
  razonSocial: z
    .string()
    .trim()
    .max(200, { error: 'La razón social no puede tener más de 200 caracteres' }),
  contacto: z
    .string()
    .trim()
    .max(150, { error: 'El contacto no puede tener más de 150 caracteres' }),
  telefono: z
    .string()
    .trim()
    .max(100, { error: 'El teléfono no puede tener más de 100 caracteres' }),
  email: z
    .string()
    .trim()
    .max(200, { error: 'El email no puede tener más de 200 caracteres' })
    .refine((v) => v === '' || z.email().safeParse(v).success, { error: 'El email no es válido' }),
  direccion: z
    .string()
    .trim()
    .max(300, { error: 'La dirección no puede tener más de 300 caracteres' }),
  // Fiscal/comercial (F9-E4): el RFC valida su FORMA en el backend (A1); aquí solo el largo. Los días
  // de crédito son un entero opcional (vacío = contado).
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .max(13, { error: 'El RFC no puede tener más de 13 caracteres' }),
  diasCredito: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 3650), {
      error: 'Los días de crédito deben ser un entero entre 0 y 3650',
    }),
});

/** Datos del formulario de cliente (todo texto; vacío = sin capturar). */
type DatosClienteFormulario = z.infer<typeof esquemaClienteFormulario>;

/** Valores por defecto de un alta: todos los campos vacíos. */
const VALORES_INICIALES: DatosClienteFormulario = {
  nombre: '',
  razonSocial: '',
  contacto: '',
  telefono: '',
  email: '',
  direccion: '',
  rfc: '',
  diasCredito: '',
};

/** Lee un campo de texto opcional del cliente para el formulario (`null` -> ''). */
function texto(valor: string | null): string {
  return valor ?? '';
}

/** Lee un campo numérico opcional del cliente como texto del `<input>` (`null` -> ''). */
function numeroTexto(valor: number | null): string {
  return valor === null ? '' : String(valor);
}

/** Texto opcional para EDICION: vacío -> `null` (BORRA el dato); con valor -> el texto. */
function textoONull(valor: string): string | null {
  return valor.length > 0 ? valor : null;
}

/** Número opcional para EDICION: vacío -> `null` (BORRA el dato); con valor -> el número. */
function numeroONull(valor: string): number | null {
  return valor.trim() === '' ? null : Number(valor);
}

/**
 * Diálogo de alta y edición de un cliente (F1-E2, D7). Formulario simple
 * (react-hook-form + Zod): si recibe un `cliente` edita (PATCH); si no, da de alta
 * (POST). Los campos de referencia (D7) NO se editan aquí: se gestionan en el panel de
 * detalle con `EditorCamposCliente` (necesitan el id del cliente).
 *
 * - Alta: los opcionales vacíos se OMITEN (el backend los deja en null).
 * - Edición: los opcionales vacíos viajan como `null` para BORRARLOS (M1; un campo
 *   omitido en el PATCH no se tocaría, así que omitir no permitiría vaciarlo).
 *
 * Al guardar con éxito cierra y avisa con un toast.
 */
export function DialogoCliente({
  abierto,
  alCambiarAbierto,
  cliente,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Cliente a editar; `undefined` -> alta. */
  cliente: Cliente | undefined;
}): React.JSX.Element {
  const esEdicion = cliente !== undefined;
  const crear = useCrearCliente();
  const actualizar = useActualizarCliente();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosClienteFormulario>({
    resolver: zodResolver(esquemaClienteFormulario),
    defaultValues: VALORES_INICIALES,
  });

  // Al abrir, sincroniza el formulario con el cliente en edición (o limpia para alta).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (cliente) {
      formulario.reset({
        nombre: cliente.nombre,
        razonSocial: texto(cliente.razonSocial),
        contacto: texto(cliente.contacto),
        telefono: texto(cliente.telefono),
        email: texto(cliente.email),
        direccion: texto(cliente.direccion),
        rfc: texto(cliente.rfc),
        diasCredito: numeroTexto(cliente.diasCredito),
      });
    } else {
      formulario.reset(VALORES_INICIALES);
    }
  }, [abierto, cliente, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      // Edición: los opcionales vacíos viajan como `null` para BORRARLOS (M1).
      const cuerpo: ClienteEditar = {
        nombre: datos.nombre,
        razonSocial: textoONull(datos.razonSocial),
        contacto: textoONull(datos.contacto),
        telefono: textoONull(datos.telefono),
        email: textoONull(datos.email),
        direccion: textoONull(datos.direccion),
        rfc: textoONull(datos.rfc),
        diasCredito: numeroONull(datos.diasCredito),
      };
      actualizar.mutate(
        { id: cliente.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Cliente "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    // Alta: los opcionales vacíos se OMITEN (el backend los deja en null).
    const cuerpo: ClienteCrear = { nombre: datos.nombre };
    if (datos.razonSocial.length > 0) cuerpo.razonSocial = datos.razonSocial;
    if (datos.contacto.length > 0) cuerpo.contacto = datos.contacto;
    if (datos.telefono.length > 0) cuerpo.telefono = datos.telefono;
    if (datos.email.length > 0) cuerpo.email = datos.email;
    if (datos.direccion.length > 0) cuerpo.direccion = datos.direccion;
    if (datos.rfc.length > 0) cuerpo.rfc = datos.rfc;
    if (datos.diasCredito.trim().length > 0) cuerpo.diasCredito = Number(datos.diasCredito);
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Cliente "${resultado.nombre}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos de este cliente.'
                : 'Captura los datos del nuevo cliente del catálogo.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-6 overflow-y-auto py-4 pr-1">
            <LeyendaObligatorios />

            {/* ── Identidad (comercial + legal) ────────────────────────────── */}
            <FieldSet>
              <FieldLegend variant="label">Identidad</FieldLegend>
              <FieldGroup>
                <Field data-invalid={Boolean(errors.nombre)}>
                  <FieldLabel htmlFor="cliente-nombre" required>
                    Nombre
                  </FieldLabel>
                  <Input
                    id="cliente-nombre"
                    autoFocus
                    placeholder="Ej. Distribuidora Liverpool, S.A. de C.V."
                    aria-invalid={Boolean(errors.nombre)}
                    disabled={guardando}
                    {...registrar('nombre')}
                  />
                  <FieldError errors={[errors.nombre]} />
                </Field>

                <Field data-invalid={Boolean(errors.razonSocial)}>
                  <FieldLabel htmlFor="cliente-razon-social">Razón social</FieldLabel>
                  <Input
                    id="cliente-razon-social"
                    placeholder="Ej. El Puerto de Liverpool, S.A.B. de C.V."
                    aria-invalid={Boolean(errors.razonSocial)}
                    disabled={guardando}
                    {...registrar('razonSocial')}
                  />
                  <FieldDescription>
                    Nombre legal para la factura si difiere del comercial.
                  </FieldDescription>
                  <FieldError errors={[errors.razonSocial]} />
                </Field>
              </FieldGroup>
            </FieldSet>

            {/* ── Contacto ─────────────────────────────────────────────────── */}
            <FieldSet>
              <FieldLegend variant="label">Contacto</FieldLegend>
              <FieldGroup>
                <Field data-invalid={Boolean(errors.contacto)}>
                  <FieldLabel htmlFor="cliente-contacto">Contacto</FieldLabel>
                  <Input
                    id="cliente-contacto"
                    placeholder="Ej. Laura Méndez (Compras)"
                    aria-invalid={Boolean(errors.contacto)}
                    disabled={guardando}
                    {...registrar('contacto')}
                  />
                  <FieldError errors={[errors.contacto]} />
                </Field>

                <Field data-invalid={Boolean(errors.telefono)}>
                  <FieldLabel htmlFor="cliente-telefono">Teléfono</FieldLabel>
                  <Input
                    id="cliente-telefono"
                    placeholder="Ej. 55 1234 5678"
                    aria-invalid={Boolean(errors.telefono)}
                    disabled={guardando}
                    {...registrar('telefono')}
                  />
                  <FieldError errors={[errors.telefono]} />
                </Field>

                <Field data-invalid={Boolean(errors.email)}>
                  <FieldLabel htmlFor="cliente-email">Email</FieldLabel>
                  <Input
                    id="cliente-email"
                    type="email"
                    placeholder="Ej. compras@liverpool.com.mx"
                    aria-invalid={Boolean(errors.email)}
                    disabled={guardando}
                    {...registrar('email')}
                  />
                  <FieldError errors={[errors.email]} />
                </Field>

                <Field data-invalid={Boolean(errors.direccion)}>
                  <FieldLabel htmlFor="cliente-direccion">Dirección</FieldLabel>
                  <Input
                    id="cliente-direccion"
                    placeholder="Ej. Av. Insurgentes Sur 1234, CDMX"
                    aria-invalid={Boolean(errors.direccion)}
                    disabled={guardando}
                    {...registrar('direccion')}
                  />
                  <FieldError errors={[errors.direccion]} />
                </Field>
              </FieldGroup>
            </FieldSet>

            {/* ── Fiscal y crédito ─────────────────────────────────────────── */}
            <FieldSet>
              <FieldLegend variant="label">Fiscal y crédito</FieldLegend>
              <FieldGroup>
                <Field data-invalid={Boolean(errors.rfc)}>
                  <FieldLabel htmlFor="cliente-rfc">RFC</FieldLabel>
                  <Input
                    id="cliente-rfc"
                    placeholder="Ej. DLI950101ABC"
                    className="uppercase"
                    aria-invalid={Boolean(errors.rfc)}
                    disabled={guardando}
                    {...registrar('rfc')}
                  />
                  <FieldDescription>Para conciliar el CFDI de venta (F9).</FieldDescription>
                  <FieldError errors={[errors.rfc]} />
                </Field>

                <Field data-invalid={Boolean(errors.diasCredito)}>
                  <FieldLabel htmlFor="cliente-dias-credito">Días de crédito</FieldLabel>
                  <Input
                    id="cliente-dias-credito"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="Ej. 30"
                    aria-invalid={Boolean(errors.diasCredito)}
                    disabled={guardando}
                    {...registrar('diasCredito')}
                  />
                  <FieldDescription>
                    Base del vencimiento en CxC. Vacío o 0 = de contado.
                  </FieldDescription>
                  <FieldError errors={[errors.diasCredito]} />
                </Field>
              </FieldGroup>
            </FieldSet>

            {!esEdicion ? (
              <AvisoAlta>
                Después, en el detalle, agrega sus departamentos (NIÑOS, DAMAS…), sus campos propios
                (p. ej. &quot;No. de pedido del cliente&quot;) y sus listas de precios.
              </AvisoAlta>
            ) : null}
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
              data-testid="guardar-cliente"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear cliente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
