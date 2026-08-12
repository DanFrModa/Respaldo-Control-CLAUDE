import { useState } from 'react';

import { useAvios, type Avio } from '@/api/avios';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE AVÍO reutilizable (F4-E1, pulido R9): combobox con búsqueda server-side por
 * clave/descripción; al elegir emite el avío completo. Distingue los GENÉRICOS de stock (R4) con
 * un badge en la opción. Lo usan el kardex de avíos, el ajuste/traspaso de avíos y el filtro de
 * existencias. La lista vive en el POPOVER del {@link ComboboxBuscable} unificado del kit (modo
 * `busquedaServidor`: anti-carrera). Presentación pura (A1).
 */
export function SelectorAvio({
  idSeleccionado,
  alSeleccionar,
  alLimpiar,
  idInput,
  testid = 'selector-avio',
}: {
  idSeleccionado: number | undefined;
  alSeleccionar: (avio: Avio) => void;
  /** Si viene, el combobox muestra ✕ para limpiar la selección (uso como filtro). */
  alLimpiar?: () => void;
  /** `id` del input, para que un `<label htmlFor>` externo lo enfoque (formularios con Field). */
  idInput?: string | undefined;
  testid?: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useAvios({
    pagina: 1,
    porPagina: 8,
    ordenarPor: 'clave',
    direccion: 'asc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const avios = consulta.data?.datos ?? [];
  // Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): el combobox no debe
  // ofrecer las opciones viejas — clickearlas seleccionaba el avío EQUIVOCADO (carrera del e2e).
  const resolviendo = texto.trim() !== busqueda || consulta.isPending;

  return (
    <ComboboxBuscable
      opciones={avios.map((a) => ({ ...a, nombre: a.clave }))}
      valor={idSeleccionado ?? null}
      onChange={(id) => {
        if (id === null) {
          alLimpiar?.();
          return;
        }
        const avio = avios.find((a) => a.id === id);
        if (avio !== undefined) {
          alSeleccionar(avio);
        }
      }}
      alCambiarTexto={setTexto}
      busquedaServidor
      renderOpcion={(o) => (
        <OpcionRica
          principal={o.clave}
          secundario={o.descripcion}
          extra={
            o.esGenerico ? (
              <Badge variant="secondary" className="shrink-0">
                Genérico
              </Badge>
            ) : null
          }
        />
      )}
      mensajeError={consulta.isError ? consulta.error.message : undefined}
      conLupa
      permitirLimpiar={alLimpiar !== undefined}
      cargando={resolviendo}
      placeholder="Buscar avío por clave o descripción…"
      etiqueta="Buscar avío"
      textoVacio="No hay avíos que coincidan."
      testid={testid}
      testidInput={`${testid}-busqueda`}
      idInput={idInput}
    />
  );
}
