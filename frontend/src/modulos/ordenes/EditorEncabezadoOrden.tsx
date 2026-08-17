import { zodResolver } from '@hookform/resolvers/zod';
import { Undo2Icon } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useEtiquetasMarca } from '@/api/etiquetas-marca';
import { useActualizarOrden } from '@/api/ordenes';
import type { Orden, OrdenEditar } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import {
  ENCABEZADO_VACIO,
  esquemaOrdenFormulario,
  fechaACuerpo,
  idACuerpo,
  textoACuerpo,
  type DatosOrdenFormulario,
} from './esquemas';
import { SelectorProveedor } from '../cxp/SelectorProveedor';
import { SelectorTela } from '../inventarios/SelectorTela';

import { useReinicioBloqueado, useSeccionGuardable, type EjecutorGuardado } from './guardado-orden';

/** Tope alto: catálogos activos para los selectores del encabezado. */
const QUERY_ETIQUETAS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Una casilla (checkbox) etiquetada, consistente con el resto de la UI. */
function Casilla({
  id,
  etiqueta,
  checked,
  alCambiar,
  deshabilitado,
  testid,
}: {
  id: string;
  etiqueta: string;
  checked: boolean;
  alCambiar: (valor: boolean) => void;
  deshabilitado: boolean;
  testid: string;
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="size-4 rounded border-input accent-primary"
        checked={checked}
        disabled={deshabilitado}
        onChange={(e) => alCambiar(e.target.checked)}
        data-testid={testid}
      />
      {etiqueta}
    </label>
  );
}

/**
 * Formulario EDITABLE del encabezado de una orden (F2-E3, `PATCH /api/ordenes/{id}`):
 * fecha/fechaEntrega, etiqueta de marca, tela, maquilero, composición, observaciones, obsMaquila
 * y "no costear". Usa react-hook-form + Zod (solo UX); el backend re-valida y es la autoridad (A1).
 * Solo editable con `ordenes.administrar` y si la orden no está cancelada.
 *
 * NO tiene botón propio de guardar (Daniel 24-jul-2026): se registra en el guardado ÚNICO del
 * diálogo (`useSeccionGuardable`), que junta los cambios de todas las secciones en un solo botón.
 *
 * COMPOSICIÓN (Daniel 24-jul-2026): la fuente es la ficha del MODELO y la orden la hereda sola;
 * este campo es el OVERRIDE de ESTA orden. Por eso ya NO se captura la bandera "capturada a mano"
 * (`compForzada`): la deriva el backend — escribir algo distinto marca override, vaciar el campo
 * devuelve la orden a la composición del modelo.
 */
export function EditorEncabezadoOrden({
  orden,
  puedeAdministrar,
}: {
  orden: Orden;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const soloLectura = orden.estado === 'cancelada' || !puedeAdministrar;
  const actualizar = useActualizarOrden();

  const etiquetas = useEtiquetasMarca(QUERY_ETIQUETAS);

  const formulario = useForm<DatosOrdenFormulario>({
    resolver: zodResolver(esquemaOrdenFormulario),
    defaultValues: ENCABEZADO_VACIO,
  });

  // Mientras se guarda (o tras un guardado a medias) NO se recarga: la pantalla debe conservar
  // exactamente lo capturado para que "Guardar" lo reintente sin que el usuario recapture nada.
  const reinicioBloqueado = useReinicioBloqueado();

  // Carga los valores de la orden al cambiar de orden.
  useEffect(() => {
    if (reinicioBloqueado) {
      return;
    }
    formulario.reset({
      idMaquilero: orden.idMaquilero === null ? '' : String(orden.idMaquilero),
      idEtiquetaMarca: orden.idEtiquetaMarca === null ? '' : String(orden.idEtiquetaMarca),
      idTela: orden.idTela === null ? '' : String(orden.idTela),
      fecha: orden.fecha ?? '',
      fechaEntrega: orden.fechaEntrega ?? '',
      composicion: orden.composicion ?? '',
      observaciones: orden.observaciones ?? '',
      obsMaquila: orden.obsMaquila ?? '',
      noCostear: orden.noCostear,
    });
  }, [orden, formulario, reinicioBloqueado]);

  // Guardado ÚNICO del diálogo: se CAPTURA el cuerpo ahora y se devuelve el ejecutor que lo manda
  // (así ninguna otra sección puede pisar esta captura mientras se guardan las demás).
  const idOrden = orden.id;
  const preparar = useCallback(async (): Promise<EjecutorGuardado | null> => {
    const valido = await formulario.trigger();
    if (!valido) {
      toast.error('Revisa los datos del encabezado.');
      return null;
    }
    const datos = formulario.getValues();
    const cuerpo: OrdenEditar = {
      idMaquilero: idACuerpo(datos.idMaquilero),
      idEtiquetaMarca: idACuerpo(datos.idEtiquetaMarca),
      idTela: idACuerpo(datos.idTela),
      fecha: fechaACuerpo(datos.fecha),
      fechaEntrega: fechaACuerpo(datos.fechaEntrega),
      // `compForzada` NO viaja: la deriva el backend de la composición capturada (Daniel 24-jul).
      composicion: textoACuerpo(datos.composicion),
      observaciones: textoACuerpo(datos.observaciones),
      obsMaquila: textoACuerpo(datos.obsMaquila),
      noCostear: datos.noCostear,
    };
    return async () => {
      await actualizar.mutateAsync({ id: idOrden, cuerpo });
    };
  }, [formulario, actualizar, idOrden]);

  useSeccionGuardable(
    'encabezado',
    'el encabezado',
    !soloLectura && formulario.formState.isDirty,
    preparar,
  );

  const guardando = actualizar.isPending;
  const registrar = formulario.register;
  const { setValue } = formulario;
  // La tela del encabezado se elige con el combobox buscable: su valor sigue en el formulario
  // (string vacío = sin asignar), y aquí se lee como número para el selector.
  const idTelaFormulario = formulario.watch('idTela');
  const idMaquileroFormulario = formulario.watch('idMaquilero');
  const idTelaSeleccionada =
    idTelaFormulario === undefined || idTelaFormulario === ''
      ? undefined
      : Number(idTelaFormulario);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="orden-fecha">Fecha de la orden</FieldLabel>
          <Input id="orden-fecha" type="date" disabled={soloLectura} {...registrar('fecha')} />
        </Field>
        <Field>
          <FieldLabel htmlFor="orden-fecha-entrega">Fecha de entrega</FieldLabel>
          <Input
            id="orden-fecha-entrega"
            type="date"
            disabled={soloLectura}
            {...registrar('fechaEntrega')}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="orden-etiqueta">Etiqueta de marca</FieldLabel>
          <SelectNativo
            id="orden-etiqueta"
            disabled={soloLectura}
            {...registrar('idEtiquetaMarca')}
          >
            <option value="">Sin asignar</option>
            {(etiquetas.data?.datos ?? []).map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.nombre}
              </option>
            ))}
          </SelectNativo>
        </Field>
        <Field>
          <FieldLabel htmlFor="orden-tela">Tela</FieldLabel>
          {/* Combobox con búsqueda SERVER-SIDE (V1-E3c): el `<select>` con tope de 100 dejaba
              fuera a la mayoría de las 877 telas y solo "buscaba" por prefijo. El valor sigue
              viviendo en el formulario (string), así que el guardado no cambia. */}
          <SelectorTela
            idInput="orden-tela"
            deshabilitado={soloLectura}
            idSeleccionado={idTelaSeleccionada}
            {...(orden.tela === null ? {} : { etiquetaSeleccion: orden.tela })}
            alSeleccionar={(tela) =>
              setValue('idTela', String(tela.id), { shouldDirty: true, shouldValidate: true })
            }
            alLimpiar={() => setValue('idTela', '', { shouldDirty: true, shouldValidate: true })}
            testid="orden-tela"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="orden-maquilero">Maquilero</FieldLabel>
          {/* V1-E3f (§Post-F9.52 punto 7): buscador en el SERVIDOR, acotado a los talleres de
              costura. Antes era un `<select>` con tope de 100 (el mismo defecto de la tela, que
              ya se había arreglado justo arriba). */}
          <SelectorProveedor
            idInput="orden-maquilero"
            idSeleccionado={
              idMaquileroFormulario === '' ? undefined : Number(idMaquileroFormulario)
            }
            nombreSeleccionado={orden.maquilero ?? undefined}
            alSeleccionar={(p) =>
              setValue('idMaquilero', String(p.id), { shouldDirty: true, shouldValidate: true })
            }
            alLimpiar={() =>
              setValue('idMaquilero', '', { shouldDirty: true, shouldValidate: true })
            }
            rol="maquila-costura"
            testid="orden-maquilero"
          />
        </Field>
        {/* Composición: la fuente es la ficha del MODELO (Daniel 24-jul-2026); esto es el
            override de ESTA orden. Vaciar el campo la devuelve a la del modelo. */}
        <Field>
          <FieldLabel htmlFor="orden-composicion">Composición</FieldLabel>
          <Input
            id="orden-composicion"
            disabled={soloLectura}
            placeholder="Se hereda del modelo"
            {...registrar('composicion')}
          />
          <FieldDescription data-testid="orden-composicion-origen">
            {orden.compForzada
              ? 'Editada en esta orden: ya no se hereda del modelo. Vacía el campo para volver a la del modelo.'
              : 'Se hereda de la ficha del modelo; si la editas aquí, esta orden conserva tu valor.'}
          </FieldDescription>
          {orden.compForzada && !soloLectura ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={guardando}
              onClick={() => setValue('composicion', '', { shouldDirty: true })}
              data-testid="orden-composicion-del-modelo"
            >
              <Undo2Icon aria-hidden />
              Volver a la del modelo
            </Button>
          ) : null}
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="orden-observaciones">Observaciones</FieldLabel>
        <textarea
          id="orden-observaciones"
          rows={2}
          disabled={soloLectura}
          className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
          {...registrar('observaciones')}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="orden-obs-maquila">Observaciones de maquila</FieldLabel>
        <textarea
          id="orden-obs-maquila"
          rows={2}
          disabled={soloLectura}
          className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
          {...registrar('obsMaquila')}
        />
      </Field>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Casilla
          id="orden-no-costear"
          etiqueta="No costear esta orden"
          checked={formulario.watch('noCostear')}
          alCambiar={(v) => setValue('noCostear', v, { shouldDirty: true })}
          deshabilitado={soloLectura}
          testid="orden-no-costear"
        />
      </div>
    </div>
  );
}
