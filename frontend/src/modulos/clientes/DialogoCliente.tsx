import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  // Abreviatura (§Post-F9.34): el "CYA" del código de desarrollo. Vacía = sin capturar; con
  // valor, 2–6 letras/dígitos en MAYÚSCULAS (el backend re-valida y exige que sea única, A1).
  abreviatura: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || /^[A-Z0-9]{2,6}$/.test(v), {
      error: 'La abreviatura debe tener de 2 a 6 letras o dígitos, sin espacios',
    }),
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
  abreviatura: '',
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

  // Departamentos capturados en el alta (D13/R16). Viven FUERA de react-hook-form (lista dinámica) y
  // solo aplican en modo CREAR; en edición se gestionan en el detalle. `nuevoDepto` es el texto del input.
  const [departamentos, setDepartamentos] = useState<string[]>([]);
  const [nuevoDepto, setNuevoDepto] = useState('');

  // Al abrir, sincroniza el formulario con el cliente en edición (o limpia para alta).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    setDepartamentos([]);
    setNuevoDepto('');
    if (cliente) {
      formulario.reset({
        nombre: cliente.nombre,
        abreviatura: texto(cliente.abreviatura),
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

  /**
   * Agrega el departamento tecleado a la lista del alta. Recorta, ignora vacíos y evita duplicados
   * (insensible a mayúsculas, con aviso suave); el backend re-valida y es la autoridad (A1).
   */
  function agregarDepartamento(): void {
    const nombre = nuevoDepto.trim();
    if (nombre === '') {
      return;
    }
    const yaEsta = departamentos.some((d) => d.toLocaleLowerCase() === nombre.toLocaleLowerCase());
    if (yaEsta) {
      toast.info(`El departamento "${nombre}" ya está en la lista.`);
      return;
    }
    setDepartamentos((previos) => [...previos, nombre]);
    setNuevoDepto('');
  }

  /** Quita un departamento capturado de la lista del alta. */
  function quitarDepartamento(nombre: string): void {
    setDepartamentos((previos) => previos.filter((d) => d !== nombre));
  }

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      // Edición: los opcionales vacíos viajan como `null` para BORRARLOS (M1).
      const cuerpo: ClienteEditar = {
        nombre: datos.nombre,
        abreviatura: textoONull(datos.abreviatura),
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
    if (datos.abreviatura.length > 0) cuerpo.abreviatura = datos.abreviatura;
    if (datos.razonSocial.length > 0) cuerpo.razonSocial = datos.razonSocial;
    if (datos.contacto.length > 0) cuerpo.contacto = datos.contacto;
    if (datos.telefono.length > 0) cuerpo.telefono = datos.telefono;
    if (datos.email.length > 0) cuerpo.email = datos.email;
    if (datos.direccion.length > 0) cuerpo.direccion = datos.direccion;
    if (datos.rfc.length > 0) cuerpo.rfc = datos.rfc;
    if (datos.diasCredito.trim().length > 0) cuerpo.diasCredito = Number(datos.diasCredito);
    if (departamentos.length > 0) cuerpo.departamentos = departamentos;
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

                <Field data-invalid={Boolean(errors.abreviatura)}>
                  <FieldLabel htmlFor="cliente-abreviatura">Abreviatura</FieldLabel>
                  <Input
                    id="cliente-abreviatura"
                    placeholder="Ej. CYA"
                    maxLength={6}
                    className="uppercase"
                    aria-invalid={Boolean(errors.abreviatura)}
                    disabled={guardando}
                    {...registrar('abreviatura')}
                  />
                  <FieldDescription>
                    Las 2 a 6 letras con las que arranca el nº de DESARROLLO de sus modelos
                    (CYA-26-71-001). Sin ella no se le pueden dar de alta modelos nuevos de
                    desarrollo.
                  </FieldDescription>
                  <FieldError errors={[errors.abreviatura]} />
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

            {/* ── Departamentos (solo alta, D13/R16) ───────────────────────── */}
            {!esEdicion ? (
              <FieldSet>
                <FieldLegend variant="label">Departamentos</FieldLegend>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="cliente-departamento">Agregar departamento</FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id="cliente-departamento"
                        value={nuevoDepto}
                        onChange={(e) => setNuevoDepto(e.target.value)}
                        onKeyDown={(e) => {
                          // Enter agrega el departamento SIN enviar el formulario del cliente.
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            agregarDepartamento();
                          }
                        }}
                        placeholder="Ej. NIÑOS"
                        disabled={guardando}
                        data-testid="cliente-departamento-input"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={agregarDepartamento}
                        disabled={guardando || nuevoDepto.trim() === ''}
                        data-testid="agregar-departamento-alta"
                      >
                        Agregar
                      </Button>
                    </div>
                    <FieldDescription>
                      Opcional. Divisiones del cliente (NIÑOS, DAMAS, CABALLEROS…); base de los
                      proyectos de desarrollo. Podrás editarlos después en el detalle.
                    </FieldDescription>
                  </Field>

                  {departamentos.length > 0 ? (
                    <ul className="flex flex-wrap gap-2" data-testid="lista-departamentos-alta">
                      {departamentos.map((nombre) => (
                        <li
                          key={nombre}
                          data-testid="chip-departamento"
                          className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-1 pr-1 pl-3 text-sm"
                        >
                          <span className="font-medium">{nombre}</span>
                          <button
                            type="button"
                            onClick={() => quitarDepartamento(nombre)}
                            disabled={guardando}
                            aria-label={`Quitar departamento ${nombre}`}
                            className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <XIcon className="size-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </FieldGroup>
              </FieldSet>
            ) : null}

            {!esEdicion ? (
              <AvisoAlta>
                Después, en el detalle, agrega sus campos propios (p. ej. &quot;No. de pedido del
                cliente&quot;) y sus listas de precios.
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
