import { useState } from 'react';

import { useModelos, type Modelo } from '@/api/modelos';
import { useDebounce } from '@/lib/useDebounce';

import { ComboboxEntidad } from './ComboboxEntidad';

/**
 * SELECTOR DE MODELO reutilizable (F3-E3, pulido R9): combobox con búsqueda server-side por código
 * o descripción; al elegir emite el modelo completo. Lo usan las pantallas de movimientos,
 * traspasos, kardex y existencias para fijar el modelo sobre el que se opera. La lista vive en un
 * POPOVER ({@link ComboboxEntidad}) — abre al enfocar/teclear, no infla el layout del toolbar.
 * Presentación pura (A1): solo consulta y emite.
 */
export function SelectorModelo({
  idSeleccionado,
  alSeleccionar,
  alLimpiar,
  testid = 'selector-modelo',
}: {
  idSeleccionado: number | undefined;
  alSeleccionar: (modelo: Modelo) => void;
  /** Si viene, el combobox muestra ✕ para limpiar la selección (uso como filtro). */
  alLimpiar?: () => void;
  testid?: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useModelos({
    pagina: 1,
    porPagina: 8,
    ordenarPor: 'codigo',
    direccion: 'asc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const modelos = consulta.data?.datos ?? [];
  const seleccionado = modelos.find((m) => m.id === idSeleccionado);
  // Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): el combobox no debe
  // ofrecer las opciones viejas — clickearlas seleccionaba el modelo EQUIVOCADO (carrera del e2e).
  const resolviendo = texto.trim() !== busqueda || consulta.isPending;

  return (
    <ComboboxEntidad
      opciones={modelos}
      obtenerId={(m) => m.id}
      principal={(m) => m.codigo}
      secundario={(m) => m.descripcion}
      idSeleccionado={idSeleccionado}
      // Si el modelo elegido ya no está en la página consultada, el texto tecleado se conserva.
      etiquetaSeleccion={idSeleccionado !== undefined ? (seleccionado?.codigo ?? texto) : undefined}
      alSeleccionar={alSeleccionar}
      alLimpiar={alLimpiar}
      alCambiarTexto={setTexto}
      cargando={resolviendo}
      mensajeError={consulta.isError ? consulta.error.message : undefined}
      placeholder="Buscar modelo por código o descripción…"
      etiqueta="Buscar modelo"
      textoVacio="No hay modelos que coincidan."
      testid={testid}
    />
  );
}
