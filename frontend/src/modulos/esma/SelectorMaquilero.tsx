import { useMaquilerosEsMa } from '@/api/esma';
import type { EsMaMaquilerosQuery } from '@/api/tipos';
import { Field, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';

/** Tipo de maquilero del selector: costura, estampado o cualquier rol de maquila (''). */
export type TipoMaquilero = '' | 'costura' | 'estampado';

/**
 * Selector reutilizable de MAQUILERO (F6-E5, ex `QueTipoMaq`): un select de TIPO (costura/estampado)
 * + un select del MAQUILERO ACTIVO del tipo elegido (`GET /api/esma/maquileros?tipo=`). Al cambiar el
 * tipo se limpia el maquilero (avisando por `onCambioTipo`). Reemplaza el selector de E4 que traía
 * TODOS los proveedores con tope 100.
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
  const query: EsMaMaquilerosQuery = tipo === '' ? {} : { tipo };
  const maquileros = useMaquilerosEsMa(query);

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
          <option value="estampado">Estampado</option>
        </SelectNativo>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefijo}-maquilero`}>Maquilero</FieldLabel>
        <SelectNativo
          id={`${idPrefijo}-maquilero`}
          value={idMaquilero}
          onChange={(e) => onCambioMaquilero(e.target.value)}
          disabled={maquileros.isPending}
          data-testid={`${idPrefijo}-maquilero`}
        >
          <option value="">{maquileros.isPending ? 'Cargando…' : 'Elige un maquilero…'}</option>
          {(maquileros.data?.filas ?? []).map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.corto ? `${m.nombre} (${m.corto})` : m.nombre}
            </option>
          ))}
        </SelectNativo>
      </Field>
    </>
  );
}
