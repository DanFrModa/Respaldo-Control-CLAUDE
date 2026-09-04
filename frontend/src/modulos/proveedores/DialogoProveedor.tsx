import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm, type UseFormRegister } from 'react-hook-form';
import { toast } from 'sonner';

import {
  type DatosProveedorFormulario,
  ETIQUETAS_METODO_PAGO,
  ETIQUETAS_MODALIDAD_FACTURACION,
  ETIQUETAS_MONEDA,
  esquemaProveedorFormulario,
  METODOS_PAGO_PROVEEDOR,
  MODALIDADES_FACTURACION,
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
import type { MetodoPagoClave, ModalidadFacturacionClave, MonedaClave } from '@/api/esquemas';
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
import { EditorCuentasPagoProveedor } from './EditorCuentasPagoProveedor';
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
  formaPagoPreferida: '',
  metodoPago: SIN_ELEGIR,
  limiteCredito: '',
  // Operativo
  leadTimeDias: '',
  condiciones: '',
  notas: '',
  // Datos de taller (fusión de terceros, D12/R15)
  asegurado: false,
  obsPago: '',
  // Facturación (fila 0.110): arranca sin elegir A PROPÓSITO — el alta no se puede guardar hasta
  // que se conteste, que es justo lo que Daniel pidió ("a fuerzas hay que definir…").
  modalidadFacturacion: SIN_ELEGIR,
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
 *   - Las banderas (retenciones, asegurado) viajan siempre como boolean.
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
  // ⭐ La modalidad de facturación va DESDE LA CONSTRUCCIÓN, no como un añadido después: el tipo
  // generado del contrato la exige (fila 0.110), así que el compilador no deja armar el cuerpo sin
  // ella. Que llegue con un valor válido lo garantiza el `.refine` del esquema del formulario —y el
  // backend re-valida, que es la autoridad (A1)—.
  const cuerpo: ProveedorCrear = {
    nombre: datos.nombre,
    modalidadFacturacion: datos.modalidadFacturacion as ModalidadFacturacionClave,
  };

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
    ['formaPagoPreferida', datos.formaPagoPreferida],
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
  // ⚠️ `factura` ya NO viaja (fila 0.124): salió del contrato de escritura. Quien conteste
  // *"¿este proveedor factura?"* es `modalidadFacturacion`, que va arriba desde la construcción.
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
 * (retenciones/asegurado) viajan como boolean; los numericos/enum opcionales vacios van
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
    formaPagoPreferida: datos.formaPagoPreferida === '' ? null : datos.formaPagoPreferida,
    // `banco`/`clabe` YA NO viajan (0.112): el dato bancario vive en las CUENTAS del proveedor.
    // Omitirlos en el PATCH = "no tocar", así que lo ya capturado se queda donde está (REGLA 0-B:
    // lo viejo no se migra ni se repara — tampoco se borra de paso).
    condiciones: textoONull(datos.condiciones),
    notas: textoONull(datos.notas),
    // Datos de taller (fusión de terceros, D12/R15): texto opcional vacio -> null (borrar).
    obsPago: textoONull(datos.obsPago),
    // Banderas: siempre viajan como boolean. `factura` NO está (fila 0.124): la columna vieja se
    // queda como histórico y ninguna edición la toca (REGLA 0-B).
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
    // Facturación (fila 0.110): NO lleva el `?? null` de los demás enums, porque vaciarla es
    // justamente lo que el backend rechaza. Nunca llega vacía: el `.refine` del formulario corta
    // antes de enviar.
    modalidadFacturacion: datos.modalidadFacturacion as ModalidadFacturacionClave,
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
 * La validacion de captura es solo UX: el backend re-valida y es la autoridad (A1). Al guardar con
 * exito cierra y avisa con un toast.
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

  /**
   * ⚠️ **El proveedor VIVE; la SIEMBRA del formulario, no.** La pantalla entrega a propósito la
   * versión fresca de la consulta (para que el editor de cuentas y el de contactos vean lo que
   * acaban de agregar), así que este objeto cambia de IDENTIDAD cada vez que algo de adentro
   * invalida la lista — aunque su contenido sea el mismo.
   *
   * 🔴 **Por eso `proveedor` NO puede ser dependencia del efecto de abajo.** Lo era, y el resultado
   * era que agregar una cuenta de pago con el formulario a medio corregir **revertía en silencio lo
   * que la persona llevaba escrito** (teléfono, RFC, razón social…) y tiraba la Constancia ya leída
   * y todavía no conservada. El efecto siembra **una sola vez por apertura** —de eso hablan sus
   * dependencias `[abierto, proveedor?.id]`— y lee el objeto por REFERENCIA, siempre el último.
   */
  const proveedorRef = useRef(proveedor);
  useEffect(() => {
    proveedorRef.current = proveedor;
  });

  // Al abrir, sincroniza UNA VEZ el formulario y los roles con el proveedor en edicion (o limpia).
  const idEnEdicion = proveedor?.id;
  useEffect(() => {
    if (!abierto) {
      return;
    }
    const proveedor = proveedorRef.current;
    setErrorRoles(null);
    setPdfConstancia(null);
    if (proveedor) {
      formulario.reset({
        // General
        nombre: proveedor.nombre,
        nombreCorto: texto(proveedor.nombreCorto),
        razonSocial: texto(proveedor.razonSocial),
        // Fiscal
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
        formaPagoPreferida: proveedor.formaPagoPreferida ?? '',
        metodoPago: texto(proveedor.metodoPago),
        limiteCredito: numeroTexto(proveedor.limiteCredito),
        // Operativo
        leadTimeDias: numeroTexto(proveedor.leadTimeDias),
        condiciones: texto(proveedor.condiciones),
        notas: texto(proveedor.notas),
        // Datos de taller (fusión de terceros, D12/R15)
        asegurado: bandera(proveedor.asegurado),
        obsPago: texto(proveedor.obsPago),
        // Facturación (fila 0.110). Un proveedor MIGRADO la trae en null y aquí se ve vacía: la
        // ficha abre y se consulta con toda normalidad (REGLA 0-B). Lo único que cambia es que,
        // para GUARDAR, hay que elegirla.
        modalidadFacturacion: texto(proveedor.modalidadFacturacion),
      });
      setIdsRoles(proveedor.roles.map((rol) => rol.id));
    } else {
      formulario.reset(VALORES_INICIALES);
      setIdsRoles([]);
    }
    // ⚠️ `proveedor` NO va aquí a propósito (se lee del ref): con él, cada refetch de la lista
    // reseteaba el formulario encima de lo que la persona estaba escribiendo. Ver el bloque de
    // arriba. El `id` sí, para reseembrar cuando se abre con OTRO proveedor.
  }, [abierto, idEnEdicion, formulario]);

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

  const modalidadElegida = formulario.watch('modalidadFacturacion');
  /**
   * §Post-F9.56 punto 4 — Daniel: *"si no emite CFDI, no debe pedir RFC"*. Los datos fiscales solo
   * se piden a quien factura.
   *
   * ⭐ Se DERIVA de la modalidad (fila 0.124), que es la única pregunta que queda: `solo_sin` es el
   * único que no factura. Mientras la modalidad no se elija —y en el alta arranca sin elegir— los
   * campos fiscales SE VEN: esconderlos antes de la respuesta obligaría a contestar en un orden que
   * nadie pidió, y la modalidad ya es obligatoria para guardar (fila 0.110).
   *
   * Espejo exacto de `admiteCfdi` en el backend (`dominio/terceros/facturacion-proveedor.ts`), que
   * es la autoridad (A1).
   */
  const emiteFactura = modalidadElegida !== 'solo_sin';
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
                // ⚠️ La constancia YA NO contesta "¿factura?" (fila 0.124). Antes encendía la
                // casilla `factura` para que los campos fiscales recién llenados se vieran; hoy esa
                // pregunta es la MODALIDAD, y la constancia no puede contestarla: estar dado de alta
                // en el SAT no dice si a NOSOTROS nos factura siempre, nunca o de las dos formas
                // (un taller registrado que nunca timbra es un caso real de Daniel). Se deja como
                // la elija la persona; mientras no la elija, los campos fiscales se ven igual.
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

                    {/* ⭐ MODALIDAD DE FACTURACIÓN — obligatoria (fila 0.110, §Post-F9.186(a)).
                        Daniel: *"es un campo obligatorio de llenar. A fuerzas hay que definir si es
                        con, sin o ambas"*. Va en GENERAL, no en Fiscal, a propósito: Fiscal y Pago
                        son secciones PLEGADAS por defecto, y un campo obligatorio escondido detrás
                        de un acordeón cerrado deja al usuario con un error que no puede ni ver.
                        Además no es un dato del SAT: es de quién y cómo se le paga. */}
                    <Field data-invalid={Boolean(errors.modalidadFacturacion)}>
                      <FieldLabel htmlFor="proveedor-modalidad-facturacion" required>
                        ¿Cómo factura?
                      </FieldLabel>
                      <SelectNativo
                        id="proveedor-modalidad-facturacion"
                        aria-invalid={Boolean(errors.modalidadFacturacion)}
                        disabled={guardando}
                        data-testid="proveedor-modalidad-facturacion"
                        {...registrar('modalidadFacturacion')}
                      >
                        <option value={SIN_ELEGIR}>Elige una opción…</option>
                        {MODALIDADES_FACTURACION.map((modalidad) => (
                          <option key={modalidad} value={modalidad}>
                            {ETIQUETAS_MODALIDAD_FACTURACION[modalidad]}
                          </option>
                        ))}
                      </SelectNativo>
                      <FieldDescription>
                        La ÚNICA pregunta de facturación del proveedor: decide de dónde sale su pago
                        —lo que va CON factura se paga desde el estado de cuenta del banco; lo que
                        va SIN factura, desde la relación de pagos— y también si se le puede
                        capturar un CFDI. Si maneja las dos, se elige movimiento por movimiento.
                      </FieldDescription>
                      <FieldError errors={[errors.modalidadFacturacion]} />
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
                    {/* 🔴 AQUÍ ESTABA la casilla *"¿Emite factura (CFDI)?"* (fila 0.124). Se
                        retiró: contestaba la MISMA pregunta que «¿Cómo factura?» (sección General)
                        y nada impedía que se contradijeran — un proveedor podía quedar dicho de las
                        dos formas y sus pagos se partían según por qué puerta entraran. La única
                        respuesta vive ahora en la modalidad; lo de abajo se deriva de ella. */}

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
                            Sin RFC no se le puede capturar una factura (CFDI): el sistema no
                            tendría contra qué comprobar quién facturó.
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

                    {/*
                      ⭐ EFECTIVO o TRANSFERENCIA por omisión para la corrida semanal (0.113;
                      §Post-F9.189(c)): *«podemos dejarlo como default de cada proveedor, pero con
                      opción a cambiarlo»*. Cada renglón de la corrida lo puede cambiar.

                      🔴 Sustituye al campo de TEXTO LIBRE anterior (la clave del SAT, "03 —
                      Transferencia"), que contestaba la misma pregunta sin poder gobernar nada:
                      dejar los dos capturables era repetir el defecto que `factura` /
                      `modalidadFacturacion` arrastraban y que la fila 0.124 ya cerró. El campo viejo
                      sigue en la base (REGLA 0-B: lo viejo no se migra ni se repara), pero ya no se
                      captura.
                    */}
                    <Field data-invalid={Boolean(errors.formaPagoPreferida)}>
                      <FieldLabel htmlFor="proveedor-forma-pago">
                        Forma de pago por omisión
                      </FieldLabel>
                      <SelectNativo
                        id="proveedor-forma-pago"
                        aria-invalid={Boolean(errors.formaPagoPreferida)}
                        disabled={guardando}
                        {...registrar('formaPagoPreferida')}
                      >
                        <option value="">Sin preferencia</option>
                        <option value="efectivo">Efectivo</option>
                        <option value="transferencia">Transferencia</option>
                      </SelectNativo>
                      <FieldError errors={[errors.formaPagoPreferida]} />
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

                    {/* El BANCO y la CLABE ya no se capturan aquí (0.112): un proveedor tiene
                        VARIAS cuentas, con su beneficiario —que casi nunca es él— y su marca
                        fiscal. Viven en la sección «Cuentas de pago». */}

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

              {/* ── Cuentas de pago (N por proveedor, 0.112) ─────────────────── */}
              <AccordionItem value="cuentas-pago">
                <AccordionTrigger>Cuentas de pago</AccordionTrigger>
                <AccordionContent>
                  {esEdicion ? (
                    <EditorCuentasPagoProveedor
                      idProveedor={proveedor.id}
                      cuentas={proveedor.cuentasPago}
                      nombreProveedor={proveedor.nombre}
                    />
                  ) : (
                    <FieldDescription data-testid="cuentas-pago-requiere-guardar">
                      Guarda el proveedor primero y luego captura a nombre de quién se le deposita
                      (que casi nunca es él) y sus cuentas: una queda por omisión y las demás como
                      historial reutilizable.
                    </FieldDescription>
                  )}
                </AccordionContent>
              </AccordionItem>

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
  campo: 'retieneIva' | 'retieneIsr' | 'asegurado';
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
