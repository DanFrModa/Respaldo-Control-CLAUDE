import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, type UseFormRegister } from 'react-hook-form';
import { toast } from 'sonner';

import {
  type DatosProveedorFormulario,
  ETIQUETAS_METODO_PAGO,
  ETIQUETAS_MONEDA,
  esquemaProveedorFormulario,
  METODOS_PAGO_PROVEEDOR,
  MONEDAS_PROVEEDOR,
  numeroOpcionalACuerpo,
  SIN_ELEGIR,
} from '@/api/esquemas';
import {
  useActualizarProveedor,
  useCrearProveedor,
  useRolesProveedor,
  useSubirAdjuntoProveedor,
} from '@/api/proveedores';
import type { MetodoPagoClave, MonedaClave } from '@/api/esquemas';
import type { Proveedor, ProveedorCrear, ProveedorEditar } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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

import { AdjuntadorProveedor } from './AdjuntadorProveedor';
import { EditorContactosProveedor } from './EditorContactosProveedor';
import { LectorConstanciaProveedor } from './LectorConstanciaProveedor';
import { SelectorRolesProveedor } from './SelectorRolesProveedor';

/**
 * CÓDIGOS de rol que hacen del proveedor un TALLER (presta un servicio sobre la prenda). Solo con
 * alguno de éstos tiene sentido preguntar "¿está asegurado?" — §Post-F9.56 punto 7, Daniel:
 * *"«Está asegurado» solo aplica a maquila"*. `otros-servicios` entra a propósito: es donde aterriza
 * el "proceso raro" que no justifica rol propio (§Post-F9.54 punto 2), y también es un taller.
 */
const ROLES_DE_TALLER = new Set([
  'maquila-costura',
  'corte',
  'estampado',
  'bordado',
  'lavado',
  'aplicacion',
  'otros-servicios',
]);

/**
 * Valores por defecto de un alta: todos los campos vacios (banderas en falso,
 * enum-opcionales "sin elegir"). Los roles se manejan aparte (estado local) y
 * arrancan vacios.
 */
const VALORES_INICIALES: DatosProveedorFormulario = {
  // General
  nombre: '',
  nombreCorto: '',
  razonSocial: '',
  // Fiscal
  factura: false,
  rfc: '',
  regimenFiscalSat: '',
  usoCfdiHabitual: '',
  codigoPostalExpedicion: '',
  retieneIva: false,
  retieneIsr: false,
  // Contacto
  email: '',
  direccion: '',
  telefono: '',
  // Pago
  diasCredito: '',
  moneda: SIN_ELEGIR,
  formaPago: '',
  metodoPago: SIN_ELEGIR,
  banco: '',
  clabe: '',
  limiteCredito: '',
  // Operativo
  leadTimeDias: '',
  condiciones: '',
  notas: '',
  // Datos de taller (fusión de terceros, D12/R15)
  asegurado: false,
  obsPago: '',
};

/** Lee un campo de texto opcional del proveedor para el formulario (`null` -> ''). */
function texto(valor: string | null): string {
  return valor ?? '';
}

/** Lee un campo numerico opcional del proveedor como texto del `<input>` (`null` -> ''). */
function numeroTexto(valor: number | null): string {
  return valor === null ? '' : String(valor);
}

/** Lee una bandera opcional del proveedor (`null` -> `false`). */
function bandera(valor: boolean | null): boolean {
  return valor ?? false;
}

/**
 * Pasa al cuerpo del API un enum-opcional capturado como string: vacio -> se OMITE
 * (el campo no viaja, el backend lo deja igual/null); con valor -> se castea al
 * literal del API. La validacion del valor ya la hizo el schema/UI; el backend
 * re-valida y es la autoridad (A1).
 */
function enumOpcional<T extends string>(valor: string): T | undefined {
  return valor === SIN_ELEGIR ? undefined : (valor as T);
}

/**
 * Traduce la captura del formulario al cuerpo del API. Reglas:
 *   - `nombre` siempre va.
 *   - Los textos opcionales vacios se OMITEN (el backend los deja como null/sin cambio).
 *   - Las banderas (factura, retenciones) viajan siempre como boolean.
 *   - Los numericos opcionales se convierten con `numeroOpcionalACuerpo` (vacio -> se omite).
 *   - Los enum-opcionales (moneda/metodoPago) se omiten si "sin elegir".
 *   - `roles` se inyecta aparte (estado local del dialogo); aqui solo se arman los
 *     campos del formulario.
 *
 * Se usa SOLO para ALTA (POST), donde omitir = el backend lo deja en null. Para
 * EDICION se usa {@link aCuerpoEditar}, que en vez de omitir manda `null` para BORRAR
 * un dato que se dejo vacio (un campo omitido en el PATCH no se tocaria, M1).
 */
function aCuerpoFormulario(datos: DatosProveedorFormulario): ProveedorCrear {
  const cuerpo: ProveedorCrear = { nombre: datos.nombre };

  // ── Textos opcionales (se omiten si vacios) ─────────────────────────────────
  const textos: Array<[keyof ProveedorCrear, string]> = [
    ['nombreCorto', datos.nombreCorto],
    ['razonSocial', datos.razonSocial],
    ['rfc', datos.rfc],
    ['regimenFiscalSat', datos.regimenFiscalSat],
    ['usoCfdiHabitual', datos.usoCfdiHabitual],
    ['codigoPostalExpedicion', datos.codigoPostalExpedicion],
    ['email', datos.email],
    ['direccion', datos.direccion],
    ['telefono', datos.telefono],
    ['formaPago', datos.formaPago],
    ['banco', datos.banco],
    ['clabe', datos.clabe],
    ['condiciones', datos.condiciones],
    ['notas', datos.notas],
    // Datos de taller (fusión de terceros, D12/R15).
    ['obsPago', datos.obsPago],
  ];
  for (const [clave, valor] of textos) {
    if (valor.length > 0) {
      // Asignacion segura: todas estas claves son `string | undefined` en ProveedorCrear.
      (cuerpo as Record<string, unknown>)[clave] = valor;
    }
  }

  // ── Banderas (siempre viajan) ───────────────────────────────────────────────
  cuerpo.factura = datos.factura;
  cuerpo.retieneIva = datos.retieneIva;
  cuerpo.retieneIsr = datos.retieneIsr;
  // Datos de taller (fusión de terceros, D12/R15).
  cuerpo.asegurado = datos.asegurado;

  // ── Numericos opcionales (se omiten si vacios) ──────────────────────────────
  const diasCredito = numeroOpcionalACuerpo(datos.diasCredito);
  if (diasCredito !== undefined) {
    cuerpo.diasCredito = diasCredito;
  }
  const limiteCredito = numeroOpcionalACuerpo(datos.limiteCredito);
  if (limiteCredito !== undefined) {
    cuerpo.limiteCredito = limiteCredito;
  }
  const leadTimeDias = numeroOpcionalACuerpo(datos.leadTimeDias);
  if (leadTimeDias !== undefined) {
    cuerpo.leadTimeDias = leadTimeDias;
  }

  // ── Enum-opcionales (se omiten si "sin elegir") ─────────────────────────────
  const moneda = enumOpcional<MonedaClave>(datos.moneda);
  if (moneda !== undefined) {
    cuerpo.moneda = moneda;
  }
  const metodoPago = enumOpcional<MetodoPagoClave>(datos.metodoPago);
  if (metodoPago !== undefined) {
    cuerpo.metodoPago = metodoPago;
  }

  return cuerpo;
}

/** Texto opcional para EDICION: vacio -> `null` (BORRA el dato); con valor -> el texto. */
function textoONull(valor: string): string | null {
  return valor.length > 0 ? valor : null;
}

/**
 * Traduce la captura del formulario al cuerpo del PATCH (EDICION). A diferencia del
 * alta, los campos opcionales que quedan VACIOS viajan como `null` para BORRAR el dato
 * (M1): en un PATCH parcial, un campo OMITIDO no se tocaria, así que omitirlo nunca
 * permitiría vaciar un valor ya capturado. `nombre` y `tipo` siempre van; las banderas
 * (factura/retenciones) viajan como boolean; los numericos/enum opcionales vacios van
 * como `null`. Los `roles` los inyecta el `enviar` (estado local, nunca `[]`).
 */
function aCuerpoEditar(datos: DatosProveedorFormulario): ProveedorEditar {
  const cuerpo: ProveedorEditar = {
    nombre: datos.nombre,
    // Textos opcionales: vacio -> null (borrar).
    nombreCorto: textoONull(datos.nombreCorto),
    razonSocial: textoONull(datos.razonSocial),
    rfc: textoONull(datos.rfc),
    regimenFiscalSat: textoONull(datos.regimenFiscalSat),
    usoCfdiHabitual: textoONull(datos.usoCfdiHabitual),
    codigoPostalExpedicion: textoONull(datos.codigoPostalExpedicion),
    email: textoONull(datos.email),
    direccion: textoONull(datos.direccion),
    telefono: textoONull(datos.telefono),
    formaPago: textoONull(datos.formaPago),
    banco: textoONull(datos.banco),
    clabe: textoONull(datos.clabe),
    condiciones: textoONull(datos.condiciones),
    notas: textoONull(datos.notas),
    // Datos de taller (fusión de terceros, D12/R15): texto opcional vacio -> null (borrar).
    obsPago: textoONull(datos.obsPago),
    // Banderas: siempre viajan como boolean.
    factura: datos.factura,
    retieneIva: datos.retieneIva,
    retieneIsr: datos.retieneIsr,
    asegurado: datos.asegurado,
    // Numericos opcionales: vacio -> null (borrar).
    diasCredito: numeroOpcionalACuerpo(datos.diasCredito) ?? null,
    limiteCredito: numeroOpcionalACuerpo(datos.limiteCredito) ?? null,
    leadTimeDias: numeroOpcionalACuerpo(datos.leadTimeDias) ?? null,
    // Enum-opcionales: "sin elegir" -> null (borrar).
    moneda: enumOpcional<MonedaClave>(datos.moneda) ?? null,
    metodoPago: enumOpcional<MetodoPagoClave>(datos.metodoPago) ?? null,
  };

  return cuerpo;
}

/**
 * Dialogo de alta y edicion del proveedor enriquecido (F1-E1B, R15). El formulario
 * se agrupa en SECCIONES PLEGABLES (acordeon): General · Fiscal · Contacto · Pago ·
 * Operativo, mas Roles (selector multiple, ≥1 obligatorio) y, SOLO en edicion,
 * Adjuntos (PDFs en R2). Replica el patron de Almacenes (react-hook-form + Zod):
 * si recibe un `proveedor` edita (PATCH); si no, da de alta (POST).
 *
 * - Los `roles` van INLINE en el cuerpo de crear/editar (misma transaccion A2). El
 *   estado de ids seleccionados vive aqui; en alta se exige ≥1; en edicion, si no se
 *   tocan, se mandan los actuales (nunca `[]`, que el backend trataria como "quitar
 *   todos").
 * - Los adjuntos necesitan el id del proveedor, asi que solo se montan en edicion;
 *   en alta se muestra un aviso para guardar primero.
 *
 * La validacion de captura es solo UX (incl. factura ⇒ RFC + regimen): el backend
 * re-valida y es la autoridad (A1). Al guardar con exito cierra y avisa con un toast.
 */
export function DialogoProveedor({
  abierto,
  alCambiarAbierto,
  proveedor,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Proveedor a editar; `undefined` -> alta. */
  proveedor: Proveedor | undefined;
}): React.JSX.Element {
  const esEdicion = proveedor !== undefined;
  const crear = useCrearProveedor();
  const actualizar = useActualizarProveedor();
  const subirAdjunto = useSubirAdjuntoProveedor();
  const guardando = crear.isPending || actualizar.isPending;

  const rolesCatalogo = useRolesProveedor();

  // Roles seleccionados: estado local (no son texto del schema). Se validan al
  // enviar (≥1) y se envian inline en el cuerpo del API.
  const [idsRoles, setIdsRoles] = useState<number[]>([]);
  const [errorRoles, setErrorRoles] = useState<string | null>(null);
  /** PDF de la constancia que se leyó, para CONSERVARLO como adjunto al guardar (§Post-F9.55). */
  const [pdfConstancia, setPdfConstancia] = useState<File | null>(null);

  const formulario = useForm<DatosProveedorFormulario>({
    resolver: zodResolver(esquemaProveedorFormulario),
    defaultValues: VALORES_INICIALES,
  });

  // Al abrir, sincroniza el formulario y los roles con el proveedor en edicion (o limpia).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    setErrorRoles(null);
    setPdfConstancia(null);
    if (proveedor) {
      formulario.reset({
        // General
        nombre: proveedor.nombre,
        nombreCorto: texto(proveedor.nombreCorto),
        razonSocial: texto(proveedor.razonSocial),
        // Fiscal
        factura: bandera(proveedor.factura),
        rfc: texto(proveedor.rfc),
        regimenFiscalSat: texto(proveedor.regimenFiscalSat),
        usoCfdiHabitual: texto(proveedor.usoCfdiHabitual),
        codigoPostalExpedicion: texto(proveedor.codigoPostalExpedicion),
        retieneIva: bandera(proveedor.retieneIva),
        retieneIsr: bandera(proveedor.retieneIsr),
        // Contacto
        email: texto(proveedor.email),
        direccion: texto(proveedor.direccion),
        telefono: texto(proveedor.telefono),
        // Pago
        diasCredito: numeroTexto(proveedor.diasCredito),
        moneda: texto(proveedor.moneda),
        formaPago: texto(proveedor.formaPago),
        metodoPago: texto(proveedor.metodoPago),
        banco: texto(proveedor.banco),
        clabe: texto(proveedor.clabe),
        limiteCredito: numeroTexto(proveedor.limiteCredito),
        // Operativo
        leadTimeDias: numeroTexto(proveedor.leadTimeDias),
        condiciones: texto(proveedor.condiciones),
        notas: texto(proveedor.notas),
        // Datos de taller (fusión de terceros, D12/R15)
        asegurado: bandera(proveedor.asegurado),
        obsPago: texto(proveedor.obsPago),
      });
      setIdsRoles(proveedor.roles.map((rol) => rol.id));
    } else {
      formulario.reset(VALORES_INICIALES);
      setIdsRoles([]);
    }
  }, [abierto, proveedor, formulario]);

  /**
   * Sube el PDF de la constancia como adjunto `CONSTANCIA` del proveedor, si se leyó uno
   * (§Post-F9.55: *"la constancia se CONSERVA como adjunto, no se lee y se tira"*). Es
   * BEST-EFFORT: si la subida falla, el proveedor YA quedó guardado y solo se avisa — perder el
   * adjunto no puede tumbar el alta.
   */
  function conservarConstancia(idProveedor: number): void {
    if (pdfConstancia === null) {
      return;
    }
    subirAdjunto.mutate(
      { idProveedor, archivo: pdfConstancia, tipo: 'CONSTANCIA' },
      {
        onError: () =>
          toast.warning(
            'El proveedor se guardó, pero no se pudo adjuntar la constancia. Súbela desde Adjuntos.',
          ),
      },
    );
  }

  const enviar = formulario.handleSubmit((datos) => {
    // Validacion de captura de roles (≥1). El backend es la autoridad, pero asi el
    // usuario ve el error sin un viaje al servidor.
    if (idsRoles.length === 0) {
      setErrorRoles('Elige al menos un rol o servicio.');
      return;
    }
    setErrorRoles(null);

    if (esEdicion) {
      // Edicion: los campos opcionales vacios viajan como `null` para BORRARLOS (M1).
      // Los roles SIEMPRE viajan (el usuario eligio ≥1; si no los toco, son los que se
      // poblaron al abrir). Nunca `[]`.
      const cuerpo: ProveedorEditar = { ...aCuerpoEditar(datos), roles: idsRoles };
      actualizar.mutate(
        { id: proveedor.id, cuerpo },
        {
          onSuccess: (resultado) => {
            conservarConstancia(resultado.id);
            toast.success(`Proveedor "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    // Alta: los campos opcionales vacios se OMITEN (el backend los deja en null).
    const cuerpo: ProveedorCrear = { ...aCuerpoFormulario(datos), roles: idsRoles };
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        // El id ya existe: ahora sí se puede conservar la constancia que se leyó en el alta.
        conservarConstancia(resultado.id);
        toast.success(`Proveedor "${resultado.nombre}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;

  // §Post-F9.56 punto 4 — Daniel: *"si no emite CFDI, no debe pedir RFC"*. La bandera ya existía;
  // lo que faltaba es que la pantalla la OBEDEZCA. Esconder no es impedir: el backend sigue siendo
  // la autoridad (A1) y su regla `factura ⇒ RFC + régimen` se valida igual.
  const emiteFactura = formulario.watch('factura');

  // §Post-F9.56 punto 7 — los datos de taller solo salen si el proveedor presta algún servicio.
  const esTaller = (rolesCatalogo.data ?? []).some(
    (rol) => idsRoles.includes(rol.id) && ROLES_DE_TALLER.has(rol.codigo),
  );

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos de este proveedor.'
                : 'Captura los datos del nuevo proveedor del catálogo.'}
            </DialogDescription>
          </DialogHeader>

          {/* Cuerpo desplazable: el formulario es largo, las secciones se pliegan. */}
          <div className="max-h-[60vh] space-y-3 overflow-y-auto py-4 pr-1">
            <LeyendaObligatorios />

            {/* ⭐ Constancia de Situación Fiscal (§Post-F9.55): PROPONE, no guarda. Sirve igual en
                el alta y en la edición. Lo que llena queda visible para que una persona lo revise
                antes de guardar. */}
            <LectorConstanciaProveedor
              deshabilitado={guardando}
              alProponer={(propuesta, regimen, pdf) => {
                // Se GUARDA el PDF para adjuntarlo al proveedor al terminar de guardar
                // (§Post-F9.55: la constancia se conserva, no se lee y se tira). En EDICIÓN el id
                // ya existe y se sube en el acto; en ALTA se espera a tener el id.
                setPdfConstancia(pdf);
                formulario.setValue('rfc', propuesta.rfc, { shouldDirty: true });
                formulario.setValue('razonSocial', propuesta.razonSocial, { shouldDirty: true });
                formulario.setValue('direccion', propuesta.direccion, { shouldDirty: true });
                formulario.setValue('codigoPostalExpedicion', propuesta.codigoPostalExpedicion, {
                  shouldDirty: true,
                });
                formulario.setValue('regimenFiscalSat', regimen, { shouldDirty: true });
                // Si trae RFC **y** régimen, es un proveedor que timbra: la casilla se enciende
                // para que los campos fiscales que se acaban de llenar SE VEAN (§Post-F9.56 punto
                // 4). Se exigen LOS DOS porque la regla de captura es `factura ⇒ RFC + régimen`:
                // encenderla con el régimen vacío dejaría el formulario bloqueado por un dato que
                // el papel no traía — justo lo contrario de "degradar con gracia" (§Post-F9.55).
                if (propuesta.rfc !== '' && regimen !== '') {
                  formulario.setValue('factura', true, { shouldDirty: true });
                }
                // El nombre solo se propone si está vacío: nunca se pisa lo que ya se capturó.
                if (formulario.getValues('nombre').trim() === '' && propuesta.razonSocial !== '') {
                  formulario.setValue('nombre', propuesta.razonSocial, { shouldDirty: true });
                }
              }}
            />

            <Accordion
              type="multiple"
              defaultValue={['general', 'roles']}
              className="flex flex-col gap-2"
            >
              {/* ── General ──────────────────────────────────────────────────── */}
              <AccordionItem value="general">
                <AccordionTrigger>General</AccordionTrigger>
                <AccordionContent>
                  <FieldGroup>
                    <Field data-invalid={Boolean(errors.nombre)}>
                      <FieldLabel htmlFor="proveedor-nombre" required>
                        Nombre
                      </FieldLabel>
                      <Input
                        id="proveedor-nombre"
                        autoFocus
                        placeholder="Ej. Textiles del Bajío, S.A. de C.V."
                        aria-invalid={Boolean(errors.nombre)}
                        disabled={guardando}
                        {...registrar('nombre')}
                      />
                      <FieldError errors={[errors.nombre]} />
                    </Field>

                    {/* Campo corto ÚNICO (§Post-F9.57 punto 2 / §Post-F9.58 punto 1): absorbió la
                        clave corta del taller. Sirve para el proveedor comercial y para el taller. */}
                    <Field data-invalid={Boolean(errors.nombreCorto)}>
                      <FieldLabel htmlFor="proveedor-nombre-corto">Campo corto</FieldLabel>
                      <Input
                        id="proveedor-nombre-corto"
                        placeholder="Ej. Bloom"
                        aria-invalid={Boolean(errors.nombreCorto)}
                        disabled={guardando}
                        data-testid="proveedor-nombre-corto"
                        {...registrar('nombreCorto')}
                      />
                      <FieldDescription>
                        Clave corta de uso diario, ÚNICA: sirve igual para el proveedor (Bloom para
                        BLOOM TEXTIL, arma el nombre de sus telas) y para el taller.
                      </FieldDescription>
                      <FieldError errors={[errors.nombreCorto]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.razonSocial)}>
                      <FieldLabel htmlFor="proveedor-razon-social">Razón social</FieldLabel>
                      <Input
                        id="proveedor-razon-social"
                        aria-invalid={Boolean(errors.razonSocial)}
                        disabled={guardando}
                        {...registrar('razonSocial')}
                      />
                      <FieldError errors={[errors.razonSocial]} />
                    </Field>
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>

              {/* ── Roles / servicios (inline, ≥1) ───────────────────────────── */}
              <AccordionItem value="roles">
                <AccordionTrigger>Roles / servicios</AccordionTrigger>
                <AccordionContent>
                  <SelectorRolesProveedor
                    roles={rolesCatalogo.data ?? []}
                    cargando={rolesCatalogo.isPending}
                    error={rolesCatalogo.isError ? rolesCatalogo.error.message : null}
                    seleccionados={idsRoles}
                    alCambiar={(ids) => {
                      setIdsRoles(ids);
                      if (ids.length > 0) {
                        setErrorRoles(null);
                      }
                    }}
                    mensajeError={errorRoles}
                    deshabilitado={guardando}
                  />
                </AccordionContent>
              </AccordionItem>

              {/* ── Fiscal ───────────────────────────────────────────────────── */}
              <AccordionItem value="fiscal">
                <AccordionTrigger>Fiscal</AccordionTrigger>
                <AccordionContent>
                  <FieldGroup>
                    <Casilla
                      id="proveedor-factura"
                      etiqueta="¿Emite factura (CFDI)?"
                      registrar={registrar}
                      campo="factura"
                      deshabilitado={guardando}
                    />

                    {/* §Post-F9.56 punto 4: si NO emite CFDI, los datos fiscales no se piden.
                        Daniel: *"si no emite CFDI, no debe pedir RFC"*. */}
                    {!emiteFactura ? (
                      <FieldDescription data-testid="aviso-sin-cfdi">
                        Este proveedor no emite CFDI: su documentación se captura a mano y no se le
                        piden datos fiscales.
                      </FieldDescription>
                    ) : null}

                    {emiteFactura ? (
                      <>
                        <Field data-invalid={Boolean(errors.rfc)}>
                          <FieldLabel htmlFor="proveedor-rfc">RFC</FieldLabel>
                          <Input
                            id="proveedor-rfc"
                            placeholder="Ej. TBA980101AB1"
                            className="uppercase"
                            aria-invalid={Boolean(errors.rfc)}
                            disabled={guardando}
                            {...registrar('rfc')}
                          />
                          <FieldDescription>
                            Obligatorio si el proveedor emite factura.
                          </FieldDescription>
                          <FieldError errors={[errors.rfc]} />
                        </Field>

                        <Field data-invalid={Boolean(errors.regimenFiscalSat)}>
                          <FieldLabel htmlFor="proveedor-regimen">Régimen fiscal (SAT)</FieldLabel>
                          <Input
                            id="proveedor-regimen"
                            aria-invalid={Boolean(errors.regimenFiscalSat)}
                            disabled={guardando}
                            placeholder="p. ej. 601"
                            {...registrar('regimenFiscalSat')}
                          />
                          <FieldError errors={[errors.regimenFiscalSat]} />
                        </Field>

                        <Field data-invalid={Boolean(errors.usoCfdiHabitual)}>
                          <FieldLabel htmlFor="proveedor-uso-cfdi">Uso de CFDI habitual</FieldLabel>
                          <Input
                            id="proveedor-uso-cfdi"
                            aria-invalid={Boolean(errors.usoCfdiHabitual)}
                            disabled={guardando}
                            placeholder="p. ej. G03"
                            {...registrar('usoCfdiHabitual')}
                          />
                          <FieldError errors={[errors.usoCfdiHabitual]} />
                        </Field>

                        <Field data-invalid={Boolean(errors.codigoPostalExpedicion)}>
                          <FieldLabel htmlFor="proveedor-cp">CP de expedición</FieldLabel>
                          <Input
                            id="proveedor-cp"
                            inputMode="numeric"
                            aria-invalid={Boolean(errors.codigoPostalExpedicion)}
                            disabled={guardando}
                            {...registrar('codigoPostalExpedicion')}
                          />
                          <FieldError errors={[errors.codigoPostalExpedicion]} />
                        </Field>

                        <Casilla
                          id="proveedor-retiene-iva"
                          etiqueta="Se le retiene IVA"
                          registrar={registrar}
                          campo="retieneIva"
                          deshabilitado={guardando}
                        />
                        <Casilla
                          id="proveedor-retiene-isr"
                          etiqueta="Se le retiene ISR"
                          registrar={registrar}
                          campo="retieneIsr"
                          deshabilitado={guardando}
                        />
                      </>
                    ) : null}
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>

              {/* ── Contacto ─────────────────────────────────────────────────── */}
              <AccordionItem value="contacto">
                <AccordionTrigger>Contacto</AccordionTrigger>
                <AccordionContent>
                  <FieldGroup>
                    <Field data-invalid={Boolean(errors.email)}>
                      <FieldLabel htmlFor="proveedor-email">Email</FieldLabel>
                      <Input
                        id="proveedor-email"
                        type="email"
                        aria-invalid={Boolean(errors.email)}
                        disabled={guardando}
                        {...registrar('email')}
                      />
                      <FieldError errors={[errors.email]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.direccion)}>
                      <FieldLabel htmlFor="proveedor-direccion">Dirección</FieldLabel>
                      <Input
                        id="proveedor-direccion"
                        aria-invalid={Boolean(errors.direccion)}
                        disabled={guardando}
                        {...registrar('direccion')}
                      />
                      <FieldError errors={[errors.direccion]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.telefono)}>
                      <FieldLabel htmlFor="proveedor-telefono">Teléfono</FieldLabel>
                      <Input
                        id="proveedor-telefono"
                        aria-invalid={Boolean(errors.telefono)}
                        disabled={guardando}
                        {...registrar('telefono')}
                      />
                      <FieldError errors={[errors.telefono]} />
                    </Field>

                    {/* Las PERSONAS de contacto ya no son un campo suelto: son N contactos con su
                        puesto en texto libre (§Post-F9.56 punto 1). Viven en su propia sección. */}
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>

              {/* ── Pago ─────────────────────────────────────────────────────── */}
              <AccordionItem value="pago">
                <AccordionTrigger>Pago</AccordionTrigger>
                <AccordionContent>
                  <FieldGroup>
                    <Field data-invalid={Boolean(errors.diasCredito)}>
                      <FieldLabel htmlFor="proveedor-dias-credito">Días de crédito</FieldLabel>
                      <Input
                        id="proveedor-dias-credito"
                        type="number"
                        min={0}
                        aria-invalid={Boolean(errors.diasCredito)}
                        disabled={guardando}
                        {...registrar('diasCredito')}
                      />
                      <FieldDescription>Vacío o 0 = pago de contado.</FieldDescription>
                      <FieldError errors={[errors.diasCredito]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.moneda)}>
                      <FieldLabel htmlFor="proveedor-moneda">Moneda</FieldLabel>
                      <SelectNativo
                        id="proveedor-moneda"
                        aria-invalid={Boolean(errors.moneda)}
                        disabled={guardando}
                        {...registrar('moneda')}
                      >
                        <option value={SIN_ELEGIR}>Sin especificar</option>
                        {MONEDAS_PROVEEDOR.map((moneda) => (
                          <option key={moneda} value={moneda}>
                            {ETIQUETAS_MONEDA[moneda]}
                          </option>
                        ))}
                      </SelectNativo>
                      <FieldError errors={[errors.moneda]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.formaPago)}>
                      <FieldLabel htmlFor="proveedor-forma-pago">Forma de pago</FieldLabel>
                      <Input
                        id="proveedor-forma-pago"
                        aria-invalid={Boolean(errors.formaPago)}
                        disabled={guardando}
                        placeholder="p. ej. 03 — Transferencia"
                        {...registrar('formaPago')}
                      />
                      <FieldError errors={[errors.formaPago]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.metodoPago)}>
                      <FieldLabel htmlFor="proveedor-metodo-pago">Método de pago (CFDI)</FieldLabel>
                      <SelectNativo
                        id="proveedor-metodo-pago"
                        aria-invalid={Boolean(errors.metodoPago)}
                        disabled={guardando}
                        {...registrar('metodoPago')}
                      >
                        <option value={SIN_ELEGIR}>Sin especificar</option>
                        {METODOS_PAGO_PROVEEDOR.map((metodo) => (
                          <option key={metodo} value={metodo}>
                            {ETIQUETAS_METODO_PAGO[metodo]}
                          </option>
                        ))}
                      </SelectNativo>
                      <FieldError errors={[errors.metodoPago]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.banco)}>
                      <FieldLabel htmlFor="proveedor-banco">Banco</FieldLabel>
                      <Input
                        id="proveedor-banco"
                        aria-invalid={Boolean(errors.banco)}
                        disabled={guardando}
                        {...registrar('banco')}
                      />
                      <FieldError errors={[errors.banco]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.clabe)}>
                      <FieldLabel htmlFor="proveedor-clabe">CLABE</FieldLabel>
                      <Input
                        id="proveedor-clabe"
                        inputMode="numeric"
                        placeholder="Ej. 012180001234567895"
                        aria-invalid={Boolean(errors.clabe)}
                        disabled={guardando}
                        {...registrar('clabe')}
                      />
                      <FieldDescription>18 dígitos.</FieldDescription>
                      <FieldError errors={[errors.clabe]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.limiteCredito)}>
                      <FieldLabel htmlFor="proveedor-limite-credito">Límite de crédito</FieldLabel>
                      <Input
                        id="proveedor-limite-credito"
                        type="number"
                        min={0}
                        step="0.01"
                        aria-invalid={Boolean(errors.limiteCredito)}
                        disabled={guardando}
                        {...registrar('limiteCredito')}
                      />
                      <FieldError errors={[errors.limiteCredito]} />
                    </Field>
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>

              {/* ── Operativo ────────────────────────────────────────────────── */}
              <AccordionItem value="operativo">
                <AccordionTrigger>Operativo</AccordionTrigger>
                <AccordionContent>
                  <FieldGroup>
                    <Field data-invalid={Boolean(errors.leadTimeDias)}>
                      <FieldLabel htmlFor="proveedor-lead-time">Lead time (días)</FieldLabel>
                      <Input
                        id="proveedor-lead-time"
                        type="number"
                        min={0}
                        aria-invalid={Boolean(errors.leadTimeDias)}
                        disabled={guardando}
                        {...registrar('leadTimeDias')}
                      />
                      <FieldDescription>
                        Días estimados de entrega (alimenta el MRP).
                      </FieldDescription>
                      <FieldError errors={[errors.leadTimeDias]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.notas)}>
                      <FieldLabel htmlFor="proveedor-notas">Notas</FieldLabel>
                      <textarea
                        id="proveedor-notas"
                        rows={3}
                        aria-invalid={Boolean(errors.notas)}
                        disabled={guardando}
                        className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
                        {...registrar('notas')}
                      />
                      <FieldError errors={[errors.notas]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.condiciones)}>
                      <FieldLabel htmlFor="proveedor-condiciones">Condiciones</FieldLabel>
                      <Input
                        id="proveedor-condiciones"
                        aria-invalid={Boolean(errors.condiciones)}
                        disabled={guardando}
                        {...registrar('condiciones')}
                      />
                      <FieldError errors={[errors.condiciones]} />
                    </Field>
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>

              {/* ── Datos de taller (fusión de terceros, D12/R15) ─────────────── */}
              {/* §Post-F9.56 punto 7: SOLO si el proveedor presta algún servicio sobre la prenda.
                  A un proveedor de telas no se le pregunta si "está asegurado". El backend sigue
                  aceptando el campo (es la autoridad, A1); lo que cambia es que no se pide. */}
              {esTaller ? (
                <AccordionItem value="taller">
                  <AccordionTrigger>Datos de taller</AccordionTrigger>
                  <AccordionContent>
                    <FieldGroup>
                      <Casilla
                        id="proveedor-asegurado"
                        etiqueta="¿Está asegurado?"
                        registrar={registrar}
                        campo="asegurado"
                        deshabilitado={guardando}
                      />

                      <Field data-invalid={Boolean(errors.obsPago)}>
                        <FieldLabel htmlFor="proveedor-obs-pago">Observaciones de pago</FieldLabel>
                        <textarea
                          id="proveedor-obs-pago"
                          rows={3}
                          aria-invalid={Boolean(errors.obsPago)}
                          disabled={guardando}
                          className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
                          {...registrar('obsPago')}
                        />
                        <FieldError errors={[errors.obsPago]} />
                      </Field>
                    </FieldGroup>
                  </AccordionContent>
                </AccordionItem>
              ) : null}

              {/* ── Contactos (N por proveedor, §Post-F9.56 punto 1) ─────────── */}
              <AccordionItem value="contactos">
                <AccordionTrigger>Contactos</AccordionTrigger>
                <AccordionContent>
                  {esEdicion ? (
                    <EditorContactosProveedor
                      idProveedor={proveedor.id}
                      contactos={proveedor.contactos}
                    />
                  ) : (
                    <FieldDescription data-testid="contactos-requiere-guardar">
                      Guarda el proveedor primero y luego agrega a su gente (vendedor, crédito y
                      cobranza, encargado del taller…).
                    </FieldDescription>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* ── Adjuntos (solo en edicion; necesitan el id) ──────────────── */}
              <AccordionItem value="adjuntos">
                <AccordionTrigger>Adjuntos</AccordionTrigger>
                <AccordionContent>
                  {esEdicion ? (
                    <AdjuntadorProveedor idProveedor={proveedor.id} deshabilitado={guardando} />
                  ) : (
                    <p className="text-sm text-muted-foreground" data-testid="adjuntos-aviso-alta">
                      Guarda el proveedor primero para poder adjuntar PDFs.
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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
              data-testid="guardar-proveedor"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear proveedor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Casilla (checkbox) booleana registrada en react-hook-form, con el mismo estilo
 * que las demas de la app (Usuarios). Aislada para no repetir el markup por cada
 * bandera fiscal. El `campo` debe ser una clave booleana del formulario.
 */
function Casilla({
  id,
  etiqueta,
  registrar,
  campo,
  deshabilitado,
}: {
  id: string;
  etiqueta: string;
  registrar: UseFormRegister<DatosProveedorFormulario>;
  campo: 'factura' | 'retieneIva' | 'retieneIsr' | 'asegurado';
  deshabilitado: boolean;
}): React.JSX.Element {
  return (
    <Field orientation="horizontal">
      <input
        id={id}
        type="checkbox"
        className="size-4 rounded border-input accent-primary"
        disabled={deshabilitado}
        data-testid={id}
        {...registrar(campo)}
      />
      <FieldLabel htmlFor={id} className="font-normal">
        {etiqueta}
      </FieldLabel>
    </Field>
  );
}
