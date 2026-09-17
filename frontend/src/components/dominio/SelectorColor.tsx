import { useState } from 'react';

import { useColores } from '@/api/colores';
import {
  ComboboxBuscable,
  filtrarOpciones,
  type OpcionCombobox,
} from '@/components/dominio/ComboboxBuscable';
import { useDebounce } from '@/lib/useDebounce';

/** Cuántos colores trae cada búsqueda del typeahead (la lista vive en el popover, no en el layout). */
const POR_PAGINA = 10;

/**
 * SELECTOR DE COLOR con búsqueda SERVER-SIDE (fila 0.192) — filtros, campos de captura y matrices.
 *
 * El defecto que cierra: seis pantallas elegían color con un `<select>` nativo alimentado de
 * `useColores({ porPagina: 100 })`, y **100 es el tope REAL del contrato**
 * (`contrato/esquemas/color.ts` → `.max(100)`, respaldado por `comun/paginacion.ts`). O sea que no
 * había forma de pedir más: pasando de cien colores activos, los del final del alfabeto
 * **desaparecían del desplegable sin aviso** y se leían como «ese color no existe». Una de ellas
 * —el conteo cíclico— pedía 200 y el backend le respondía **400**, así que su desplegable ya salía
 * VACÍO hoy.
 *
 * No reinventa nada: es el MISMO patrón de `SelectorProveedor` / `SelectorTela` / `SelectorCliente`
 * (typeahead con debounce sobre el `busqueda` del servidor + anti-carrera del `ComboboxBuscable`
 * del kit). Con búsqueda en el servidor da igual que el catálogo tenga 50 colores o 5,000: se
 * teclea y aparece.
 *
 * Presentación pura (A1): solo consulta y emite; ninguna regla de negocio vive aquí.
 */
export function SelectorColor({
  idSeleccionado,
  nombreSeleccionado,
  alSeleccionar,
  alLimpiar,
  excluirIds,
  opcionesExtra,
  deshabilitado = false,
  etiqueta = 'Buscar color',
  placeholder = 'Buscar color por nombre…',
  textoVacio = 'No hay colores que coincidan.',
  testid = 'selector-color',
  idInput,
}: {
  /** Color elegido, o `undefined` = ninguno. */
  idSeleccionado: number | undefined;
  /**
   * Nombre del color ya seleccionado cuando NO cae en la página de la búsqueda (edición,
   * deep-link). Sin esto el campo se ve VACÍO aunque por dentro sí haya color elegido — el mismo
   * cuidado que documenta `FiltroCliente`.
   */
  nombreSeleccionado?: string | undefined;
  /** Emite el color elegido (id + nombre ya resuelto). */
  alSeleccionar: (color: { id: number; nombre: string }) => void;
  /** Si viene, el combobox muestra ✕ para limpiar la selección (uso como filtro). */
  alLimpiar?: () => void;
  /**
   * Ids que NO deben ofrecerse (los que la pantalla ya usa: p. ej. los colores que ya son fila de
   * la matriz). Se filtran DESPUÉS de la búsqueda del servidor: filtro de PRESENTACIÓN, la regla
   * dura la impone el dominio.
   */
  excluirIds?: ReadonlySet<number> | undefined;
  /**
   * ⭐ Opciones que el catálogo VIVO no puede devolver y la pantalla sí conoce — hoy, los colores
   * RETIRADOS que todavía tienen mercancía (fila 0.164: el servidor los marca con `colorActivo` y
   * la pantalla los rotula «(retirado)»). Se filtran EN CLIENTE por lo tecleado y van al final,
   * detrás de lo que trae el servidor: el catálogo vivo es lo que se captura todos los días.
   */
  opcionesExtra?: readonly OpcionCombobox[] | undefined;
  /** Apaga el selector cuando la pantalla no deja operar (sin permiso, guardando…). */
  deshabilitado?: boolean;
  /** Etiqueta accesible del input. */
  etiqueta?: string;
  placeholder?: string;
  /** Texto del popover cuando no hay coincidencias. */
  textoVacio?: string;
  testid?: string;
  /** `id` del input (para que un `<label htmlFor>` externo lo enfoque). */
  idInput?: string | undefined;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useColores({
    pagina: 1,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const excluidos = excluirIds ?? new Set<number>();
  const delServidor = (consulta.data?.datos ?? []).map((c) => ({ id: c.id, nombre: c.nombre }));
  // Los extras se filtran con el MISMO criterio del kit (sin acentos ni mayúsculas) por lo ya
  // resuelto, no por lo tecleado: así la lista no baila mientras el debounce está en vuelo.
  const extras = filtrarOpciones(opcionesExtra ?? [], busqueda);
  const yaOfrecidos = new Set(delServidor.map((c) => c.id));
  const opciones = [...delServidor, ...extras.filter((c) => !yaOfrecidos.has(c.id))].filter(
    (c) => !excluidos.has(c.id),
  );

  /**
   * Lo TECLEADO aún no está resuelto: no ofrecer las opciones viejas — clickearlas seleccionaba el
   * color EQUIVOCADO (la carrera que documenta el kit).
   *
   * 🔴 **`isFetching` es imprescindible, y `isPending` NO basta.** `useColores` va con
   * `placeholderData: keepPreviousData`, así que en cuanto el debounce dispara la búsqueda NUEVA la
   * consulta deja de estar «pendiente» —sigue teniendo los datos de la anterior— y `isPending` se
   * apaga. Sin esta mitad, la página ANTERIOR queda clickeable durante todo el viaje al servidor.
   * Es lo mismo que hace el hermano más cercano, `ordenes/AgregarColorMatriz.tsx`, contra el MISMO
   * endpoint: que dos selectores de color se comporten distinto es la asimetría que dentro de un mes
   * nadie sabe explicar.
   */
  const resolviendo = texto.trim() !== busqueda || consulta.isPending || consulta.isFetching;

  return (
    <ComboboxBuscable
      opciones={opciones}
      valor={idSeleccionado ?? null}
      {...(nombreSeleccionado === undefined ? {} : { etiquetaSeleccion: nombreSeleccionado })}
      onChange={(id) => {
        if (id === null) {
          alLimpiar?.();
          return;
        }
        const opcion = opciones.find((o) => o.id === id);
        if (opcion !== undefined) {
          alSeleccionar(opcion);
        }
      }}
      alCambiarTexto={setTexto}
      busquedaServidor
      mensajeError={consulta.isError ? consulta.error.message : undefined}
      conLupa
      permitirLimpiar={alLimpiar !== undefined}
      cargando={resolviendo}
      placeholder={placeholder}
      etiqueta={etiqueta}
      textoVacio={textoVacio}
      deshabilitado={deshabilitado}
      testid={testid}
      testidInput={`${testid}-busqueda`}
      idInput={idInput}
    />
  );
}
