import { useState } from 'react';

import { useAvios, type Avio } from '@/api/avios';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/lib/useDebounce';

import { ComboboxEntidad } from './ComboboxEntidad';

/**
 * SELECTOR DE AVÍO reutilizable (F4-E1, pulido R9): combobox con búsqueda server-side por
 * clave/descripción; al elegir emite el avío completo. Distingue los GENÉRICOS de stock (R4) con
 * un badge en la opción. Lo usan el kardex de avíos, el ajuste/traspaso de avíos y el filtro de
 * existencias. La lista vive en un POPOVER ({@link ComboboxEntidad}). Presentación pura (A1).
 */
export function SelectorAvio({
  idSeleccionado,
  alSeleccionar,
  alLimpiar,
  testid = 'selector-avio',
}: {
  idSeleccionado: number | undefined;
  alSeleccionar: (avio: Avio) => void;
  /** Si viene, el combobox muestra ✕ para limpiar la selección (uso como filtro). */
  alLimpiar?: () => void;
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
  const seleccionado = avios.find((a) => a.id === idSeleccionado);

  return (
    <ComboboxEntidad
      opciones={avios}
      obtenerId={(a) => a.id}
      principal={(a) => a.clave}
      secundario={(a) => a.descripcion}
      extraOpcion={(a) =>
        a.esGenerico ? (
          <Badge variant="secondary" className="shrink-0">
            Genérico
          </Badge>
        ) : null
      }
      idSeleccionado={idSeleccionado}
      etiquetaSeleccion={idSeleccionado !== undefined ? (seleccionado?.clave ?? texto) : undefined}
      alSeleccionar={alSeleccionar}
      alLimpiar={alLimpiar}
      alCambiarTexto={setTexto}
      cargando={consulta.isPending}
      mensajeError={consulta.isError ? consulta.error.message : undefined}
      placeholder="Buscar avío por clave o descripción…"
      etiqueta="Buscar avío"
      textoVacio="No hay avíos que coincidan."
      testid={testid}
    />
  );
}
