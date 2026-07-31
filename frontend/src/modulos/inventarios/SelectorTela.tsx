import { useState } from 'react';

import { useTelas, type Tela } from '@/api/telas';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE TELA reutilizable (F4-E1, pulido R9): combobox con búsqueda server-side por nombre;
 * al elegir emite la tela completa. Lo usan el kardex de telas, las capturas (salida a orden,
 * traspaso, ajuste) y el filtro de existencias. La lista vive en el POPOVER del
 * {@link ComboboxBuscable} unificado del kit (modo `busquedaServidor`: anti-carrera, no infla el
 * layout). Presentación pura (A1): solo consulta y emite.
 */
export function SelectorTela({
  idSeleccionado,
  alSeleccionar,
  alLimpiar,
  testid = 'selector-tela',
}: {
  idSeleccionado: number | undefined;
  alSeleccionar: (tela: Tela) => void;
  /** Si viene, el combobox muestra ✕ para limpiar la selección (uso como filtro). */
  alLimpiar?: () => void;
  testid?: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useTelas({
    pagina: 1,
    porPagina: 8,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const telas = consulta.data?.datos ?? [];
  // Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): el combobox no debe
  // ofrecer las opciones viejas — clickearlas seleccionaba la tela EQUIVOCADA (carrera del e2e).
  const resolviendo = texto.trim() !== busqueda || consulta.isPending;

  return (
    <ComboboxBuscable
      opciones={telas}
      valor={idSeleccionado ?? null}
      onChange={(id) => {
        if (id === null) {
          alLimpiar?.();
          return;
        }
        const tela = telas.find((t) => t.id === id);
        if (tela !== undefined) {
          alSeleccionar(tela);
        }
      }}
      alCambiarTexto={setTexto}
      busquedaServidor
      renderOpcion={(o) => <OpcionRica principal={o.nombre} secundario={o.descripcion} />}
      mensajeError={consulta.isError ? consulta.error.message : undefined}
      conLupa
      permitirLimpiar={alLimpiar !== undefined}
      cargando={resolviendo}
      placeholder="Buscar tela por nombre…"
      etiqueta="Buscar tela"
      textoVacio="No hay telas que coincidan."
      testid={testid}
      testidInput={`${testid}-busqueda`}
    />
  );
}
