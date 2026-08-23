import { useEffect, useState } from 'react';

import { SelectorCliente } from '@/modulos/cxc/SelectorCliente';

/**
 * SELECTOR DE CLIENTE con búsqueda SERVER-SIDE (V1-E4 punto 7) — filtros y campos de formulario.
 *
 * El defecto que cierra: doce pantallas elegían cliente con un `<select>` nativo alimentado de
 * `useClientes({ porPagina: 100 })`. Con ~117 clientes activos —y `porPagina` topado en 100 por el
 * propio contrato de paginación del backend—, los clientes del final del alfabeto simplemente NO
 * APARECÍAN. No truena, no avisa: el usuario filtra y "ese cliente no tiene nada".
 *
 * No reinventa nada: envuelve el {@link SelectorCliente} que ya está en producción (CxC / CFDI de
 * venta), que a su vez usa el `ComboboxBuscable` del kit en modo `busquedaServidor` — el MISMO
 * patrón de `SelectorTela`/`SelectorProveedor`. Lo único que agrega es lo que un filtro/campo
 * necesita y el selector no traía: RECORDAR el nombre del cliente mostrado.
 *
 * ⚠️ POR QUÉ `nombreInicial` NO ES OPCIONAL DE ADORNO: con búsqueda server-side el combobox solo
 * conoce los 10 clientes de la página que tiene cargada. Al abrir «Editar pedido» de un cliente que
 * no esté entre los 10 primeros alfabéticamente —la enorme mayoría de 117— el campo se veía EN
 * BLANCO aunque el pedido sí tuviera cliente. Toda pantalla que llegue con una selección previa
 * debe pasar el nombre que ya tiene en la mano (`pedido.cliente`, `proyecto.cliente`…).
 *
 * Presentación pura (A1): consulta y emite; ninguna pantalla decide reglas aquí.
 */
export function FiltroCliente({
  idCliente,
  alCambiar,
  nombreInicial,
  etiqueta = 'Filtrar por cliente',
  placeholder = 'Todos los clientes',
  deshabilitado = false,
  idInput,
  testid,
}: {
  /** Cliente elegido, o `null` = ninguno / todos. */
  idCliente: number | null;
  /** Se llama con el cliente elegido (id + nombre) o con `null` al limpiar. */
  alCambiar: (cliente: { id: number; nombre: string } | null) => void;
  /**
   * Nombre del cliente que ya viene seleccionado al montar (edición / deep-link). Sin esto el
   * campo se ve VACÍO cuando ese cliente no cae en la primera página de la búsqueda.
   */
  nombreInicial?: string | undefined;
  /** Etiqueta accesible; se conserva la de la pantalla para no romper lectores ni pruebas. */
  etiqueta?: string;
  placeholder?: string;
  /** Bloquea el control (guardando, o campo no editable en edición). */
  deshabilitado?: boolean;
  /**
   * `id` del input. Las pantallas que ya tenían `<FieldLabel htmlFor="…">` lo pasan para que la
   * etiqueta siga enfocando el campo al hacer clic (al cambiar el `<select>` por el combobox esos
   * `htmlFor` habían quedado apuntando a un id inexistente).
   */
  idInput?: string | undefined;
  testid?: string;
}): React.JSX.Element {
  // Nombre del cliente ELEGIDO EN ESTA SESIÓN del componente; manda sobre `nombreInicial` porque
  // es más nuevo. Se reinicia cuando cambia `nombreInicial` (el diálogo se reabrió con otra
  // entidad), o el nombre del pedido anterior quedaría pegado.
  const [nombreElegido, setNombreElegido] = useState<string | undefined>(undefined);
  useEffect(() => {
    setNombreElegido(undefined);
  }, [nombreInicial]);

  const nombreMostrado = nombreElegido ?? nombreInicial;

  return (
    <SelectorCliente
      idSeleccionado={idCliente ?? undefined}
      {...(idCliente !== null && nombreMostrado !== undefined
        ? { nombreSeleccionado: nombreMostrado }
        : {})}
      alSeleccionar={(cliente) => {
        setNombreElegido(cliente.nombre);
        alCambiar({ id: cliente.id, nombre: cliente.nombre });
      }}
      alLimpiar={() => {
        setNombreElegido(undefined);
        alCambiar(null);
      }}
      etiqueta={etiqueta}
      placeholder={placeholder}
      deshabilitado={deshabilitado}
      idInput={idInput}
      {...(testid === undefined ? {} : { testid })}
    />
  );
}
