import { useState } from 'react';

import { useModelos, type Modelo } from '@/api/modelos';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE MODELO reutilizable (F3-E3, pulido R9): combobox con búsqueda server-side por código
 * o descripción; al elegir emite el modelo completo. Lo usan las pantallas de movimientos,
 * traspasos, kardex y existencias para fijar el modelo sobre el que se opera. La lista vive en el
 * POPOVER del {@link ComboboxBuscable} unificado del kit (modo `busquedaServidor`: anti-carrera,
 * no infla el layout del toolbar). Presentación pura (A1): solo consulta y emite.
 *
 * ⚠️ **Busca en los DOS catálogos (`origen: 'todos'`) a propósito** (V1-E3n). El default del API es
 * `produccion` porque §Post-F9.34 punto 2 habla del **catálogo y la galería** —lo que se NAVEGA—, y
 * ahí Daniel no quiere "basura". Esto es otra cosa: un buscador donde alguien TECLEA un código que ya
 * conoce; si escondiera los de desarrollo, ligar un modelo de desarrollo a un proyecto o mover una
 * muestra de PT sería imposible sin explicación. Las opciones marcan cuál es de desarrollo.
 */
export function SelectorModelo({
  idSeleccionado,
  alSeleccionar,
  alLimpiar,
  idInput,
  testid = 'selector-modelo',
  origen = 'todos',
}: {
  idSeleccionado: number | undefined;
  alSeleccionar: (modelo: Modelo) => void;
  /** Si viene, el combobox muestra ✕ para limpiar la selección (uso como filtro). */
  alLimpiar?: () => void;
  /** `id` del input, para que un `<label htmlFor>` externo lo enfoque (formularios con Field). */
  idInput?: string | undefined;
  testid?: string;
  /** Catálogo(s) donde buscar. Default `todos` — ver el encabezado del módulo. */
  origen?: 'produccion' | 'desarrollo' | 'todos';
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useModelos({
    pagina: 1,
    porPagina: 8,
    ordenarPor: 'codigo',
    direccion: 'asc',
    origen,
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const modelos = consulta.data?.datos ?? [];
  // Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): el combobox no debe
  // ofrecer las opciones viejas — clickearlas seleccionaba el modelo EQUIVOCADO (carrera del e2e).
  const resolviendo = texto.trim() !== busqueda || consulta.isPending;

  return (
    <ComboboxBuscable
      opciones={modelos.map((m) => ({ ...m, nombre: m.codigo }))}
      valor={idSeleccionado ?? null}
      onChange={(id) => {
        if (id === null) {
          alLimpiar?.();
          return;
        }
        const modelo = modelos.find((m) => m.id === id);
        if (modelo !== undefined) {
          alSeleccionar(modelo);
        }
      }}
      alCambiarTexto={setTexto}
      busquedaServidor
      renderOpcion={(o) => (
        <OpcionRica
          principal={o.codigo}
          secundario={
            o.origen === 'desarrollo'
              ? `Desarrollo · ${o.descripcion ?? 'sin descripción'}`
              : o.descripcion
          }
        />
      )}
      mensajeError={consulta.isError ? consulta.error.message : undefined}
      conLupa
      permitirLimpiar={alLimpiar !== undefined}
      cargando={resolviendo}
      placeholder="Buscar modelo por código o descripción…"
      etiqueta="Buscar modelo"
      textoVacio="No hay modelos que coincidan."
      testid={testid}
      testidInput={`${testid}-busqueda`}
      idInput={idInput}
    />
  );
}
