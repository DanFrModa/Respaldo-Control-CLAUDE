import { useMaquilerosEsMa } from '@/api/esma';
import type { EsMaMaquilerosQuery } from '@/api/tipos';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
import { Field, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';

/**
 * Tipo de maquilero del selector: costura, estampado, corte, empaque, o cualquier rol de maquila
 * (''). Corte y empaque entraron en 0.114, cuando Daniel los puso del lado de la maquila
 * (*«corte es parte de maquilas, no de proveedores … y una maquila de empaque también»*).
 */
export type TipoMaquilero = '' | 'costura' | 'estampado' | 'corte' | 'empaque';

/** Opción del combobox de maquilero: id + nombre + clave corta (línea secundaria). */
interface OpcionMaquilero {
  id: number;
  nombre: string;
  nombreCorto: string | null;
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
    nombreCorto: m.nombreCorto,
  }));

  return (
    <ComboboxBuscable<OpcionMaquilero>
      opciones={opciones}
      valor={idMaquilero === '' ? null : Number(idMaquilero)}
      onChange={(id) => onCambioMaquilero(id === null ? '' : String(id))}
      renderOpcion={(o) => (
        <OpcionRica principal={o.nombre} secundario={o.nombreCorto ?? undefined} />
      )}
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
 * Los tipos que el selector ofrece cuando NO se acota (0.114): los cinco roles de maquila, con el
 * corte y el empaque incluidos porque Daniel los puso de ese lado.
 */
const TIPOS_TODOS = ['costura', 'estampado', 'corte', 'empaque'] as const;

/** Etiqueta visible de cada tipo (el vocabulario de Daniel: la aplicación se llama ARTE). */
const ETIQUETA_TIPO: Record<Exclude<TipoMaquilero, ''>, string> = {
  costura: 'Costura',
  estampado: 'Prov. de Arte',
  corte: 'Corte',
  empaque: 'Empaque',
};

/**
 * Selector reutilizable de MAQUILERO (F6-E5, ex `QueTipoMaq`): un select de TIPO (costura/estampado
 * y, desde 0.114, corte/empaque) + el {@link ComboboxMaquilero} buscable del tipo elegido
 * (`GET /api/esma/maquileros?tipo=`). Al cambiar el tipo se limpia el maquilero (avisando por
 * `onCambioTipo`). Lo usan el estado de cuenta, el desglosado y los recibos semanales.
 *
 * `tipos` acota qué opciones se ofrecen; por default, todas. Los recibos semanales le pasan
 * `TIPOS_IDA_Y_VUELTA` (de `./comun`) porque su reporte sale de los RECIBOS y el corte/empaque no
 * tienen.
 */
export function SelectorMaquilero({
  tipo,
  onCambioTipo,
  idMaquilero,
  onCambioMaquilero,
  idPrefijo = 'sel',
  tipos = TIPOS_TODOS,
}: {
  tipo: TipoMaquilero;
  onCambioTipo: (tipo: TipoMaquilero) => void;
  idMaquilero: string;
  onCambioMaquilero: (id: string) => void;
  idPrefijo?: string;
  /** Qué tipos ofrecer (además de «Todos»). Default: todos los roles de maquila. */
  tipos?: readonly Exclude<TipoMaquilero, ''>[];
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
          {/* «Todos» significa "cualquier rol de maquila", y eso incluye SIEMPRE a cortadores y
              empacadores: es el backend quien resuelve el conjunto (`ROLES_MAQUILA_ESMA`), no esta
              lista. Acotar `tipos` sólo quita opciones de FILTRO, no esconde a nadie de «Todos». */}
          <option value="">Todos</option>
          {tipos.map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_TIPO[t]}
            </option>
          ))}
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
