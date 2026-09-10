import { useEffect, useState } from 'react';

import { SelectorProveedor } from '@/modulos/cxp/SelectorProveedor';

/**
 * SELECTOR DE PROVEEDOR con búsqueda SERVER-SIDE para FILTROS de listado (V1-E7g) — el gemelo de
 * {@link FiltroCliente}, que hace lo mismo del lado del cliente.
 *
 * El defecto que cierra es el que Daniel reportó por CUARTA vez (§Post-F9.52 punto 7): «el
 * proveedor no busca por todas sus palabras, busca sólo por orden alfabético». La causa nunca
 * estuvo en el servidor —`idsPorNombreSinAcentos` hace `LIKE %texto%` y casa EN MEDIO del
 * nombre— sino en la pantalla: un `<select>` nativo sólo deja «buscar tecleando» con el typeahead
 * del navegador, que pega ÚNICAMENTE por prefijo. Y encima las pantallas lo alimentaban con
 * `porPagina: 100`, tope del contrato: con ~1,700 proveedores reales, la enorme mayoría ni
 * siquiera estaba en la lista.
 *
 * No reinventa nada: envuelve el {@link SelectorProveedor} que ya está en producción (CxP,
 * explosión de materiales, recepción de compras), que a su vez usa el `ComboboxBuscable` del kit
 * en modo `busquedaServidor`. Lo único que agrega es lo que un filtro necesita y el selector no
 * traía: RECORDAR el nombre del proveedor mostrado.
 *
 * ⚠️ POR QUÉ `nombreInicial` IMPORTA: con búsqueda server-side el combobox sólo conoce los 10
 * proveedores de la página cargada. Una pantalla que llegue con una selección previa (deep-link,
 * edición) debe pasar el nombre que ya tiene en la mano, o el campo se ve EN BLANCO.
 *
 * Presentación pura (A1): consulta y emite; ninguna pantalla decide reglas aquí.
 */
export function FiltroProveedor({
  idProveedor,
  alCambiar,
  nombreInicial,
  rol,
  etiqueta = 'Filtrar por proveedor',
  placeholder = 'Todos los proveedores',
  deshabilitado = false,
  idInput,
  testid,
}: {
  /** Proveedor elegido, o `null` = ninguno / todos. */
  idProveedor: number | null;
  /** Se llama con el proveedor elegido (id + nombre) o con `null` al limpiar. */
  alCambiar: (proveedor: { id: number; nombre: string } | null) => void;
  /**
   * Nombre del proveedor que ya viene seleccionado al montar (edición / deep-link). Sin esto el
   * campo se ve VACÍO cuando ese proveedor no cae en la primera página de la búsqueda.
   */
  nombreInicial?: string | undefined;
  /**
   * CÓDIGO de rol (`COD_ROL_PROVEEDOR`) al que se ACOTA la búsqueda — p. ej. `corte` en el filtro
   * de cortadores. Omitirlo = sin acotar (todos los proveedores), que es lo que piden los filtros
   * de maquilero: un maquilero puede tener cualquier rol de maquila.
   */
  rol?: string | undefined;
  /** Etiqueta accesible; se conserva la de la pantalla para no romper lectores ni pruebas. */
  etiqueta?: string;
  placeholder?: string;
  /** Bloquea el control (guardando, o campo no editable). */
  deshabilitado?: boolean;
  /** `id` del input, para que un `<label htmlFor>` externo lo enfoque de verdad. */
  idInput?: string | undefined;
  testid?: string;
}): React.JSX.Element {
  // Nombre del proveedor ELEGIDO EN ESTA SESIÓN del componente; manda sobre `nombreInicial` porque
  // es más nuevo. Se reinicia cuando cambia `nombreInicial` (el diálogo se reabrió con otra
  // entidad), o el nombre anterior quedaría pegado.
  const [nombreElegido, setNombreElegido] = useState<string | undefined>(undefined);
  useEffect(() => {
    setNombreElegido(undefined);
  }, [nombreInicial]);

  const nombreMostrado = nombreElegido ?? nombreInicial;

  return (
    <SelectorProveedor
      idSeleccionado={idProveedor ?? undefined}
      {...(idProveedor !== null && nombreMostrado !== undefined
        ? { nombreSeleccionado: nombreMostrado }
        : {})}
      {...(rol === undefined ? {} : { rol })}
      alSeleccionar={(proveedor) => {
        setNombreElegido(proveedor.nombre);
        alCambiar({ id: proveedor.id, nombre: proveedor.nombre });
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
