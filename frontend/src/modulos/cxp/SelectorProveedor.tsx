import { useState } from 'react';

import { useProveedoresPorRol } from '@/api/proveedores';
import type { Proveedor } from '@/api/tipos';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE PROVEEDOR reutilizable (F9-E2): combobox con búsqueda server-side por nombre; al elegir
 * emite el proveedor completo. La lista vive en el POPOVER del {@link ComboboxBuscable} unificado
 * del kit (modo `busquedaServidor`: anti-carrera). Presentación pura (A1): solo consulta y emite.
 *
 * ⚠️ **Es EL selector de proveedor de toda la app.** Un `<select>` nativo con tope de 100 esconde
 * al proveedor que se busca en cuanto hay más de cien, y ese mismo defecto se arregló ya cuatro
 * veces por separado (BOM V1-E3c, clientes V1-E4, arte y materiales V1-E3f §Post-F9.52 punto 7).
 * Al agregar un lugar donde se elige proveedor, se usa ESTE componente — no otro desplegable.
 */
export function SelectorProveedor({
  idSeleccionado,
  nombreSeleccionado,
  alSeleccionar,
  alLimpiar,
  rol,
  excluirIds,
  deshabilitado = false,
  testid = 'selector-proveedor',
  idInput,
}: {
  idSeleccionado: number | undefined;
  /**
   * Nombre del proveedor ya seleccionado cuando NO viene de la primera página de la búsqueda (p. ej.
   * al llegar desde la bandeja con un id fijado): sin esto el input se veía vacío pese a tener saldo.
   */
  nombreSeleccionado?: string | undefined;
  alSeleccionar: (proveedor: Proveedor) => void;
  /** Si viene, el combobox muestra ✕ para limpiar la selección. */
  alLimpiar?: () => void;
  /**
   * CÓDIGO de rol (`COD_ROL_PROVEEDOR`) al que se ACOTA la búsqueda — p. ej. `vende-telas` en el alta
   * de tela (decisión P.2, 7-ago-2026). Omitirlo = sin acotar, que es lo que necesita CxP: una CxP
   * puede ser de cualquier tercero, no solo de quien vende material.
   */
  rol?: string | undefined;
  /**
   * Ids que NO deben ofrecerse (los que ya se eligieron en la pantalla que lo usa: p. ej. los
   * proveedores ya agregados a un avío o a una tela). Se filtran DESPUÉS de la búsqueda del
   * servidor, así que un proveedor ya elegido simplemente no aparece en la lista.
   */
  excluirIds?: ReadonlySet<number> | undefined;
  /**
   * Apaga el selector cuando la pantalla no deja operar (p. ej. sin el permiso de la acción,
   * §Post-F9.68: esconder Y bloquear). Default false — el uso normal es editable.
   */
  deshabilitado?: boolean;
  testid?: string;
  /** `id` del input (para que el `<label htmlFor>` del formulario lo enfoque). */
  idInput?: string | undefined;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useProveedoresPorRol(rol, {
    pagina: 1,
    porPagina: 10,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const proveedores = (consulta.data?.datos ?? []).filter(
    (p) => excluirIds === undefined || !excluirIds.has(p.id),
  );
  // Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): no ofrecer opciones viejas.
  const resolviendo = texto.trim() !== busqueda || consulta.isPending;

  return (
    <ComboboxBuscable
      opciones={proveedores.map((p) => ({ ...p, nombre: p.nombre }))}
      valor={idSeleccionado ?? null}
      etiquetaSeleccion={nombreSeleccionado}
      onChange={(id) => {
        if (id === null) {
          alLimpiar?.();
          return;
        }
        const proveedor = proveedores.find((p) => p.id === id);
        if (proveedor !== undefined) {
          alSeleccionar(proveedor);
        }
      }}
      alCambiarTexto={setTexto}
      busquedaServidor
      renderOpcion={(o) => (
        <OpcionRica principal={o.nombre} secundario={o.nombreCorto ?? undefined} />
      )}
      mensajeError={consulta.isError ? consulta.error.message : undefined}
      conLupa
      permitirLimpiar={alLimpiar !== undefined}
      cargando={resolviendo}
      deshabilitado={deshabilitado}
      placeholder="Buscar proveedor por nombre…"
      etiqueta="Buscar proveedor"
      textoVacio="No hay proveedores que coincidan."
      testid={testid}
      testidInput={`${testid}-busqueda`}
      idInput={idInput}
    />
  );
}
