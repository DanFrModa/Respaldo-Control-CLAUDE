import { useState } from 'react';

import { useClientes } from '@/api/clientes';
import type { Cliente } from '@/api/tipos';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE CLIENTE reutilizable (F9-E4): combobox con búsqueda server-side por nombre; al elegir
 * emite el cliente completo. Lo usan el estado de cuenta de CxC y la importación de CFDI de venta para
 * fijar el cliente. La lista vive en el POPOVER del {@link ComboboxBuscable} unificado del kit (modo
 * `busquedaServidor`: anti-carrera). Presentación pura (A1): solo consulta y emite.
 */
export function SelectorCliente({
  idSeleccionado,
  nombreSeleccionado,
  alSeleccionar,
  alLimpiar,
  etiqueta = 'Buscar cliente',
  placeholder = 'Buscar cliente por nombre…',
  deshabilitado = false,
  idInput,
  testid = 'selector-cliente',
}: {
  idSeleccionado: number | undefined;
  /**
   * Nombre del cliente ya seleccionado cuando NO viene de la primera página de la búsqueda (p. ej.
   * al llegar desde la bandeja con un id fijado): sin esto el input se veía vacío pese a tener saldo.
   */
  nombreSeleccionado?: string | undefined;
  alSeleccionar: (cliente: Cliente) => void;
  /** Si viene, el combobox muestra ✕ para limpiar la selección. */
  alLimpiar?: () => void;
  /**
   * Etiqueta accesible del campo (V1-E4 punto 7). Configurable para que los FILTROS de las
   * pantallas conserven su "Filtrar por cliente" al pasar del `<select>` a este combobox: cambiarla
   * en silencio rompería lectores de pantalla y pruebas que ya buscan por ese nombre.
   */
  etiqueta?: string;
  /** Texto del input vacío (los filtros dicen "Todos los clientes"). */
  placeholder?: string;
  /**
   * Bloquea el control (V1-E4). Lo necesitan los formularios que ya lo bloqueaban cuando era un
   * `<select>`: mientras guardan, y —en «Editar proyecto»— porque el cliente NO se puede cambiar
   * (cambiarlo dejaría el departamento apuntando a otro cliente y el backend rechazaría el
   * guardado). Sin esta prop, el combobox llegó EDITABLE donde antes tenía candado.
   */
  deshabilitado?: boolean;
  /** `id` del input, para que un `<FieldLabel htmlFor>` lo siga enfocando al hacer clic. */
  idInput?: string | undefined;
  testid?: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useClientes({
    pagina: 1,
    porPagina: 10,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const clientes = consulta.data?.datos ?? [];
  // Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): no ofrecer opciones viejas.
  const resolviendo = texto.trim() !== busqueda || consulta.isPending;

  return (
    <ComboboxBuscable
      opciones={clientes.map((c) => ({ ...c, nombre: c.nombre }))}
      valor={idSeleccionado ?? null}
      etiquetaSeleccion={nombreSeleccionado}
      onChange={(id) => {
        if (id === null) {
          alLimpiar?.();
          return;
        }
        const cliente = clientes.find((c) => c.id === id);
        if (cliente !== undefined) {
          alSeleccionar(cliente);
        }
      }}
      alCambiarTexto={setTexto}
      busquedaServidor
      renderOpcion={(o) => <OpcionRica principal={o.nombre} secundario={o.rfc ?? undefined} />}
      mensajeError={consulta.isError ? consulta.error.message : undefined}
      conLupa
      permitirLimpiar={alLimpiar !== undefined}
      cargando={resolviendo}
      deshabilitado={deshabilitado}
      idInput={idInput}
      placeholder={placeholder}
      etiqueta={etiqueta}
      textoVacio="No hay clientes que coincidan."
      testid={testid}
      testidInput={`${testid}-busqueda`}
    />
  );
}
