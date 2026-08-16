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
  etiquetaSeleccion,
  alSeleccionar,
  alLimpiar,
  idProveedor,
  idsExcluidos,
  deshabilitado = false,
  idInput,
  testid = 'selector-tela',
}: {
  idSeleccionado: number | undefined;
  /**
   * Nombre de la tela seleccionada, para cuando el padre la fija SIN pasar por este combobox (p. ej.
   * el atajo de "telas al tono" del lote). La página del typeahead trae 8 telas de 877: sin esta
   * etiqueta el campo se quedaría mostrando la tela ANTERIOR mientras por dentro ya hay otra
   * elegida — y se capturaría un renglón distinto del que se lee (hallazgo del reviewer).
   */
  etiquetaSeleccion?: string | undefined;
  alSeleccionar: (tela: Tela) => void;
  /** Si viene, el combobox muestra ✕ para limpiar la selección (uso como filtro). */
  alLimpiar?: () => void;
  /**
   * Acota la búsqueda a las telas de ESE proveedor DUEÑO (§Post-F9.15, petición de Daniel:
   * *"cada proveedor de telas tiene sus telas definidas. No puedo meter una felpa alsatex en el
   * proveedor bloom"*). El filtro lo aplica el SERVIDOR y es estricto: las telas migradas sin dueño
   * no aparecen (el catálogo se captura desde cero — acuerdo del 7-ago-2026).
   */
  idProveedor?: number | undefined;
  /**
   * Ids que NO se deben ofrecer (V1-E3d): p. ej. las telas que la receta de la orden YA lleva. Sin
   * esto la pantalla invita a "agregar" algo que ya está, y esa puerta pisaba el precio congelado.
   * Filtro de PRESENTACIÓN: la regla dura la impone el dominio (409).
   */
  idsExcluidos?: readonly number[];
  /** Solo lectura (p. ej. una orden cancelada): el combobox queda inerte. Default false. */
  deshabilitado?: boolean;
  /** `id` del input, para que un `<label htmlFor>` externo lo enfoque (formularios con Field). */
  idInput?: string | undefined;
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
    ...(idProveedor === undefined ? {} : { idProveedor }),
  });

  const excluidos = new Set(idsExcluidos ?? []);
  const telas = (consulta.data?.datos ?? []).filter((t) => !excluidos.has(t.id));
  // Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): el combobox no debe
  // ofrecer las opciones viejas — clickearlas seleccionaba la tela EQUIVOCADA (carrera del e2e).
  const resolviendo = texto.trim() !== busqueda || consulta.isPending;

  return (
    <ComboboxBuscable
      {...(etiquetaSeleccion === undefined ? {} : { etiquetaSeleccion })}
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
      deshabilitado={deshabilitado}
      testid={testid}
      testidInput={`${testid}-busqueda`}
      idInput={idInput}
    />
  );
}
