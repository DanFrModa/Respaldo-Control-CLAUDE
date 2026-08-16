import { useState } from 'react';

import { SelectorCliente } from '@/modulos/cxc/SelectorCliente';

/**
 * FILTRO POR CLIENTE con búsqueda SERVER-SIDE (V1-E4 punto 7).
 *
 * El defecto que cierra: doce pantallas filtraban por cliente con un `<select>` nativo alimentado
 * de `useClientes({ porPagina: 100 })`. Con ~117 clientes activos —y `porPagina` topado en 100 por
 * el propio contrato de paginación del backend—, los clientes del final del alfabeto simplemente
 * NO APARECÍAN en la lista. No truena, no avisa: el usuario filtra y "ese cliente no tiene nada".
 *
 * No reinventa nada: envuelve el {@link SelectorCliente} que ya está en producción (CxC / CFDI de
 * venta), que a su vez usa el `ComboboxBuscable` del kit en modo `busquedaServidor` — el MISMO
 * patrón de `SelectorTela`/`SelectorProveedor`. Lo único que agrega es la pieza que un filtro
 * necesita y el selector no traía: RECORDAR el nombre del cliente elegido, porque con búsqueda
 * server-side la opción seleccionada puede no venir en la página que el combobox tiene cargada y
 * el campo se vería vacío tras recargar o cambiar de búsqueda.
 *
 * Presentación pura (A1): consulta y emite; ninguna pantalla decide reglas aquí.
 */
export function FiltroCliente({
  idCliente,
  alCambiar,
  etiqueta = 'Filtrar por cliente',
  placeholder = 'Todos los clientes',
  testid,
}: {
  /** Cliente filtrado, o `null` = todos. */
  idCliente: number | null;
  /** Se llama con el cliente elegido (id + nombre) o con `null` al limpiar el filtro. */
  alCambiar: (cliente: { id: number; nombre: string } | null) => void;
  /** Etiqueta accesible; se conserva la de la pantalla para no romper lectores ni pruebas. */
  etiqueta?: string;
  placeholder?: string;
  testid?: string;
}): React.JSX.Element {
  // Nombre del cliente elegido: lo guarda ESTE componente porque el combobox, con búsqueda
  // server-side, no siempre tiene la opción en su página cargada.
  const [nombre, setNombre] = useState<string | undefined>(undefined);

  return (
    <SelectorCliente
      idSeleccionado={idCliente ?? undefined}
      {...(idCliente !== null && nombre !== undefined ? { nombreSeleccionado: nombre } : {})}
      alSeleccionar={(cliente) => {
        setNombre(cliente.nombre);
        alCambiar({ id: cliente.id, nombre: cliente.nombre });
      }}
      alLimpiar={() => {
        setNombre(undefined);
        alCambiar(null);
      }}
      etiqueta={etiqueta}
      placeholder={placeholder}
      {...(testid === undefined ? {} : { testid })}
    />
  );
}
