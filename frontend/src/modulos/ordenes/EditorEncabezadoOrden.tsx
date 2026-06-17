import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon, SaveIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useEtiquetasMarca } from '@/api/etiquetas-marca';
import { useActualizarOrden } from '@/api/ordenes';
import { useProveedores } from '@/api/proveedores';
import { useTelas } from '@/api/telas';
import type { Orden, OrdenEditar } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
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

/** Tope alto: catálogos activos para los selectores del encabezado. */
const QUERY_PROVEEDORES = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;
const QUERY_ETIQUETAS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;
const QUERY_TELAS = {
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
 * fecha/fechaEntrega, etiqueta de marca, tela, maquilero, composición + "capturada a mano",
 * observaciones, obsMaquila y "no costear". Usa react-hook-form + Zod (solo UX); el backend
 * re-valida y es la autoridad (A1). Solo editable con `ordenes.administrar` y si la orden no está
 * cancelada.
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

  const proveedores = useProveedores(QUERY_PROVEEDORES);
  const etiquetas = useEtiquetasMarca(QUERY_ETIQUETAS);
  const telas = useTelas(QUERY_TELAS);

  const formulario = useForm<DatosOrdenFormulario>({
    resolver: zodResolver(esquemaOrdenFormulario),
    defaultValues: ENCABEZADO_VACIO,
  });

  // Carga los valores de la orden al cambiar de orden.
  useEffect(() => {
    formulario.reset({
      idMaquilero: orden.idMaquilero === null ? '' : String(orden.idMaquilero),
      idEtiquetaMarca: orden.idEtiquetaMarca === null ? '' : String(orden.idEtiquetaMarca),
      idTela: orden.idTela === null ? '' : String(orden.idTela),
      fecha: orden.fecha ?? '',
      fechaEntrega: orden.fechaEntrega ?? '',
      composicion: orden.composicion ?? '',
      compForzada: orden.compForzada,
      observaciones: orden.observaciones ?? '',
      obsMaquila: orden.obsMaquila ?? '',
      noCostear: orden.noCostear,
    });
  }, [orden, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const cuerpo: OrdenEditar = {
      idMaquilero: idACuerpo(datos.idMaquilero),
      idEtiquetaMarca: idACuerpo(datos.idEtiquetaMarca),
      idTela: idACuerpo(datos.idTela),
      fecha: fechaACuerpo(datos.fecha),
      fechaEntrega: fechaACuerpo(datos.fechaEntrega),
      composicion: textoACuerpo(datos.composicion),
      compForzada: datos.compForzada,
      observaciones: textoACuerpo(datos.observaciones),
      obsMaquila: textoACuerpo(datos.obsMaquila),
      noCostear: datos.noCostear,
    };
    actualizar.mutate(
      { id: orden.id, cuerpo },
      {
        onSuccess: (res) => toast.success(`Orden ${res.folio} actualizada.`),
        onError: (error) => toast.error(error.message),
      },
    );
  });

  const guardando = actualizar.isPending;
  const registrar = formulario.register;
  const { watch, setValue } = formulario;

  return (
    <form onSubmit={(e) => void enviar(e)} noValidate className="space-y-4">
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
          <SelectNativo id="orden-tela" disabled={soloLectura} {...registrar('idTela')}>
            <option value="">Sin asignar</option>
            {(telas.data?.datos ?? []).map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.nombre}
              </option>
            ))}
          </SelectNativo>
        </Field>

        <Field>
          <FieldLabel htmlFor="orden-maquilero">Maquilero</FieldLabel>
          <SelectNativo id="orden-maquilero" disabled={soloLectura} {...registrar('idMaquilero')}>
            <option value="">Sin asignar</option>
            {(proveedores.data?.datos ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.nombre}
              </option>
            ))}
          </SelectNativo>
        </Field>
        <Field>
          <FieldLabel htmlFor="orden-composicion">Composición</FieldLabel>
          <Input
            id="orden-composicion"
            disabled={soloLectura}
            placeholder="Composición textil"
            {...registrar('composicion')}
          />
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
          id="orden-comp-forzada"
          etiqueta="Composición capturada a mano"
          checked={watch('compForzada')}
          alCambiar={(v) => setValue('compForzada', v, { shouldDirty: true })}
          deshabilitado={soloLectura}
          testid="orden-comp-forzada"
        />
        <Casilla
          id="orden-no-costear"
          etiqueta="No costear esta orden"
          checked={watch('noCostear')}
          alCambiar={(v) => setValue('noCostear', v, { shouldDirty: true })}
          deshabilitado={soloLectura}
          testid="orden-no-costear"
        />
      </div>

      {!soloLectura ? (
        <Button type="submit" size="sm" disabled={guardando} data-testid="guardar-encabezado">
          {guardando ? (
            <Loader2Icon className="animate-spin" aria-hidden />
          ) : (
            <SaveIcon aria-hidden />
          )}
          Guardar encabezado
        </Button>
      ) : null}
    </form>
  );
}
