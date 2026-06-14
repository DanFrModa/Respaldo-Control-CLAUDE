import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useColores } from '@/api/colores';
import type { Color } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import type { RenglonColor } from './colores-tela';

/**
 * Editor del GRID DE COLORES de una tela (F1-E3): cada renglon es un color del catalogo
 * (`GET /api/colores`) con su PRECIO opcional. El estado vive en el dialogo padre
 * (`colores` + `alCambiar`), que lo envia INLINE en el cuerpo del API (alta/edicion, misma
 * transaccion A2). El backend valida (color existe/activo, sin repetir) y es la autoridad
 * (A1); aqui solo se ayuda a la captura (no se puede agregar dos veces el mismo color).
 *
 * A diferencia del selector de tipos del maquilero (checkboxes ≥1), aqui el grid PUEDE ir
 * vacio y cada item lleva un dato extra (el precio). El precio se captura como texto en un
 * `<input type="number">` y la conversion a numero la hace el dialogo al armar el cuerpo.
 * Los helpers puros (`aRenglones`/`aColoresCuerpo`) y el tipo `RenglonColor` viven en
 * `./colores-tela` (regla fast-refresh: este archivo solo exporta un componente).
 */
export function EditorColoresTela({
  colores,
  alCambiar,
  deshabilitado = false,
}: {
  colores: RenglonColor[];
  alCambiar: (colores: RenglonColor[]) => void;
  deshabilitado?: boolean;
}): React.JSX.Element {
  // Catalogo de colores activos para el selector de "agregar". Una pagina amplia basta
  // (el catalogo de colores es corto); el backend re-valida de todos modos.
  const consulta = useColores({ porPagina: 100, ordenarPor: 'nombre', direccion: 'asc' });
  const datosColores = consulta.data?.datos;
  // Memoizado para estabilizar las dependencias de los useMemo de abajo.
  const catalogo = useMemo<readonly Color[]>(() => datosColores ?? [], [datosColores]);

  // Color elegido en el selector de "agregar" (id como texto del `<select>`).
  const [aAgregar, setAAgregar] = useState<string>('');

  // Colores ya en el grid (para no ofrecerlos de nuevo y para pintar su nombre).
  const idsEnGrid = useMemo(() => new Set(colores.map((c) => c.idColor)), [colores]);
  const nombrePorId = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const color of catalogo) {
      mapa.set(color.id, color.nombre);
    }
    return mapa;
  }, [catalogo]);

  // Solo los colores que aun NO estan en el grid (evita duplicados en captura).
  const disponibles = catalogo.filter((color) => !idsEnGrid.has(color.id));

  function agregar(): void {
    if (aAgregar === '') {
      return;
    }
    const id = Number(aAgregar);
    if (idsEnGrid.has(id)) {
      return;
    }
    alCambiar([...colores, { idColor: id, precioTexto: '' }]);
    setAAgregar('');
  }

  function quitar(idColor: number): void {
    alCambiar(colores.filter((c) => c.idColor !== idColor));
  }

  function cambiarPrecio(idColor: number, precioTexto: string): void {
    alCambiar(colores.map((c) => (c.idColor === idColor ? { ...c, precioTexto } : c)));
  }

  const errorCatalogo = consulta.isError ? consulta.error.message : null;

  return (
    <Field role="group" aria-labelledby="editor-colores-titulo">
      <FieldLabel id="editor-colores-titulo" asChild>
        <span>Colores con precio</span>
      </FieldLabel>
      <FieldDescription>
        Colores disponibles de esta tela y su precio por unidad (opcional). Puede no tener ninguno.
      </FieldDescription>

      {/* Agregar color */}
      <div className="flex items-center gap-2">
        <SelectNativo
          value={aAgregar}
          onChange={(e) => setAAgregar(e.target.value)}
          aria-label="Elegir un color para agregar a la tela"
          data-testid="selector-agregar-color"
          disabled={deshabilitado || consulta.isPending || disponibles.length === 0}
        >
          <option value="">
            {consulta.isPending
              ? 'Cargando colores…'
              : disponibles.length === 0
                ? 'No hay más colores'
                : 'Elige un color…'}
          </option>
          {disponibles.map((color) => (
            <option key={color.id} value={String(color.id)}>
              {color.nombre}
            </option>
          ))}
        </SelectNativo>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={agregar}
          disabled={deshabilitado || aAgregar === ''}
          data-testid="agregar-color"
        >
          <PlusIcon aria-hidden />
          Agregar
        </Button>
      </div>

      {errorCatalogo !== null ? <p className="text-sm text-destructive">{errorCatalogo}</p> : null}

      {/* Grid de colores agregados */}
      {colores.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="colores-vacio">
          Esta tela no tiene colores. Agrega los que apliquen.
        </p>
      ) : (
        <ul className="mt-1 space-y-2" data-testid="grid-colores-tela">
          {colores.map((renglon) => (
            <li
              key={renglon.idColor}
              data-testid="renglon-color"
              className="flex items-center gap-2 rounded-lg border p-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {nombrePorId.get(renglon.idColor) ?? `Color #${String(renglon.idColor)}`}
              </span>
              <Input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className="w-28"
                placeholder="Precio"
                aria-label={`Precio del color ${nombrePorId.get(renglon.idColor) ?? String(renglon.idColor)}`}
                value={renglon.precioTexto}
                disabled={deshabilitado}
                onChange={(e) => cambiarPrecio(renglon.idColor, e.target.value)}
                data-testid={`precio-color-${renglon.idColor}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => quitar(renglon.idColor)}
                disabled={deshabilitado}
                aria-label={`Quitar el color ${nombrePorId.get(renglon.idColor) ?? String(renglon.idColor)}`}
                data-testid={`quitar-color-${renglon.idColor}`}
              >
                <Trash2Icon className="text-destructive" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <FieldError errors={[]} />
    </Field>
  );
}
