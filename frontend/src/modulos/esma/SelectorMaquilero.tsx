import { useMaquilerosEsMa } from '@/api/esma';
import type { EsMaMaquilerosQuery } from '@/api/tipos';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
import { Field, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';

/** Tipo de maquilero del selector: costura, estampado o cualquier rol de maquila (''). */
export type TipoMaquilero = '' | 'costura' | 'estampado';

/** Opción del combobox de maquilero: id + nombre + clave corta (línea secundaria). */
interface OpcionMaquilero {
  id: number;
  nombre: string;
  corto: string | null;
}

/**
 * COMBOBOX BUSCABLE de MAQUILERO (R2 §4.4.1): typeahead sobre los maquileros ACTIVOS con rol de maquila
 * (`GET /api/esma/maquileros`, opcionalmente acotado por `tipo`). La lista es ACOTADA (decenas de
 * proveedores con rol de maquila), así que el filtro por teclado es LOCAL (modo por defecto del kit) —
 * NO hace falta búsqueda server-side. Sustituye al `<select>` nativo, que con la lista real no dejaba
 * teclear para buscar. Mantiene el contrato `string` de las páginas (`''` = ninguno) para no tocar su
 * estado. Presentación pura (A1): solo consulta y emite.
 */
export function ComboboxMaquilero({
  tipo = '',
  idMaquilero,
  onCambioMaquilero,
  testid,
  permitirLimpiar = true,
  placeholder = 'Buscar maquilero…',
}: {
  /** Acota la lista al rol de maquila del tipo (costura/estampado); '' trae todos los de maquila. */
  tipo?: TipoMaquilero;
  /** Id seleccionado como texto ('' = ninguno), para conservar el estado string de las páginas. */
  idMaquilero: string;
  onCambioMaquilero: (id: string) => void;
  /** Base de los data-testid: el contenedor lo lleva tal cual; el input va en `${testid}-busqueda`. */
  testid: string;
  permitirLimpiar?: boolean;
  placeholder?: string;
}): React.JSX.Element {
  const query: EsMaMaquilerosQuery = tipo === '' ? {} : { tipo };
  const maquileros = useMaquilerosEsMa(query);
  const opciones: OpcionMaquilero[] = (maquileros.data?.filas ?? []).map((m) => ({
    id: m.id,
    nombre: m.nombre,
    corto: m.corto,
  }));

  return (
    <ComboboxBuscable<OpcionMaquilero>
      opciones={opciones}
      valor={idMaquilero === '' ? null : Number(idMaquilero)}
      onChange={(id) => onCambioMaquilero(id === null ? '' : String(id))}
      renderOpcion={(o) => <OpcionRica principal={o.nombre} secundario={o.corto ?? undefined} />}
      cargando={maquileros.isFetching}
      mensajeError={maquileros.isError ? maquileros.error.message : undefined}
      conLupa
      permitirLimpiar={permitirLimpiar}
      placeholder={placeholder}
      etiqueta="Buscar maquilero"
      textoVacio="No hay maquileros que coincidan."
      testid={testid}
      testidInput={`${testid}-busqueda`}
    />
  );
}

/**
 * Selector reutilizable de MAQUILERO (F6-E5, ex `QueTipoMaq`): un select de TIPO (costura/estampado)
 * + el {@link ComboboxMaquilero} buscable del tipo elegido (`GET /api/esma/maquileros?tipo=`). Al
 * cambiar el tipo se limpia el maquilero (avisando por `onCambioTipo`). Lo usan el estado de cuenta, el
 * desglosado y los recibos semanales.
 */
export function SelectorMaquilero({
  tipo,
  onCambioTipo,
  idMaquilero,
  onCambioMaquilero,
  idPrefijo = 'sel',
}: {
  tipo: TipoMaquilero;
  onCambioTipo: (tipo: TipoMaquilero) => void;
  idMaquilero: string;
  onCambioMaquilero: (id: string) => void;
  idPrefijo?: string;
}): React.JSX.Element {
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefijo}-tipo`}>Tipo</FieldLabel>
        <SelectNativo
          id={`${idPrefijo}-tipo`}
          value={tipo}
          onChange={(e) => onCambioTipo(e.target.value as TipoMaquilero)}
          data-testid={`${idPrefijo}-tipo`}
        >
          <option value="">Todos</option>
          <option value="costura">Costura</option>
          <option value="estampado">Prov. de Arte</option>
        </SelectNativo>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefijo}-maquilero`}>Maquilero</FieldLabel>
        <ComboboxMaquilero
          tipo={tipo}
          idMaquilero={idMaquilero}
          onCambioMaquilero={onCambioMaquilero}
          testid={`${idPrefijo}-maquilero`}
        />
      </Field>
    </>
  );
}
